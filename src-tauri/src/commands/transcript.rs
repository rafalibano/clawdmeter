use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde::Deserialize;

const SYNTHETIC_MODEL: &str = "<synthetic>";
pub const READ_BUFFER: usize = 64 * 1024;
pub const MAX_LINE: usize = 1024 * 1024;

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Entry {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub timestamp: Option<String>,
    pub message: Option<Message>,
    pub params: Option<Params>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Message {
    pub id: Option<String>,
    pub model: Option<String>,
    pub usage: Option<Usage>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Params {
    pub betas: Option<Vec<String>>,
}

pub struct Reply {
    pub id: Option<String>,
    pub model: String,
    pub input: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
    pub output: u64,
}

impl Reply {
    pub fn context(&self) -> u64 {
        self.input
            .saturating_add(self.cache_read)
            .saturating_add(self.cache_creation)
    }

    fn counts(&self) -> [u64; 4] {
        [
            self.input,
            self.cache_read,
            self.cache_creation,
            self.output,
        ]
    }
}

#[derive(Default, Clone)]
pub struct RunCounts {
    id: Option<String>,
    counts: [u64; 4],
}

impl RunCounts {
    // The lines of one response share an id and the counters can grow while it streams.
    pub fn absorb(&mut self, reply: &Reply) -> (bool, [u64; 4]) {
        let now = reply.counts();
        if reply.id.is_none() || reply.id != self.id {
            self.id = reply.id.clone();
            self.counts = now;
            return (false, now);
        }
        let mut grown = [0; 4];
        for (index, value) in now.into_iter().enumerate() {
            if value > self.counts[index] {
                grown[index] = value - self.counts[index];
                self.counts[index] = value;
            }
        }
        (true, grown)
    }
}

pub fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|s| !s.is_empty())
}

pub fn assistant_reply(message: Message) -> Option<Reply> {
    let usage = message.usage?;
    let model = non_empty(message.model)?;
    // Written on API errors and interrupts with every counter at zero; it says nothing about usage.
    if model == SYNTHETIC_MODEL {
        return None;
    }
    Some(Reply {
        id: non_empty(message.id),
        model,
        input: usage.input_tokens.unwrap_or(0),
        cache_read: usage.cache_read_input_tokens.unwrap_or(0),
        cache_creation: usage.cache_creation_input_tokens.unwrap_or(0),
        output: usage.output_tokens.unwrap_or(0),
    })
}

struct LineRead {
    consumed: u64,
    complete: bool,
    oversized: bool,
}

fn next_line(reader: &mut impl BufRead, line: &mut Vec<u8>) -> std::io::Result<LineRead> {
    line.clear();
    let mut read = LineRead {
        consumed: 0,
        complete: false,
        oversized: false,
    };
    loop {
        let buf = match reader.fill_buf() {
            Ok(buf) => buf,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if buf.is_empty() {
            return Ok(read);
        }
        let newline = buf.iter().position(|&b| b == b'\n');
        let body = &buf[..newline.unwrap_or(buf.len())];
        if read.oversized || line.len() + body.len() > MAX_LINE {
            read.oversized = true;
            line.clear();
        } else {
            line.extend_from_slice(body);
        }
        let used = newline.map_or(buf.len(), |at| at + 1);
        reader.consume(used);
        read.consumed += used as u64;
        if newline.is_some() {
            read.complete = true;
            return Ok(read);
        }
    }
}

pub fn regular_file_len(path: &Path) -> std::io::Result<u64> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(std::io::Error::other("not a regular file"));
    }
    Ok(meta.len())
}

fn open_regular(path: &Path, follow_symlinks: bool) -> std::io::Result<File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let flags = if follow_symlinks {
            libc::O_NONBLOCK
        } else {
            libc::O_NONBLOCK | libc::O_NOFOLLOW
        };
        options.custom_flags(flags);
    }
    #[cfg(not(unix))]
    let _ = follow_symlinks;
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::other("not a regular file"));
    }
    Ok(file)
}

pub fn read_lines(
    path: &Path,
    from: u64,
    to: u64,
    on_line: impl FnMut(&str),
) -> std::io::Result<u64> {
    read_lines_from(open_regular(path, true)?, from, to, on_line)
}

pub fn read_lines_no_follow(
    path: &Path,
    from: u64,
    to: u64,
    on_line: impl FnMut(&str),
) -> std::io::Result<u64> {
    read_lines_from(open_regular(path, false)?, from, to, on_line)
}

fn read_lines_from(
    mut file: File,
    from: u64,
    to: u64,
    mut on_line: impl FnMut(&str),
) -> std::io::Result<u64> {
    file.seek(SeekFrom::Start(from))?;
    let mut reader = BufReader::with_capacity(READ_BUFFER, file.take(to.saturating_sub(from)));
    let mut line = Vec::new();
    let mut total = 0;
    loop {
        let read = next_line(&mut reader, &mut line)?;
        // A partial last line stays unconsumed so the next read picks it up once it is finished.
        if !read.complete {
            return Ok(total);
        }
        if !read.oversized {
            if let Ok(text) = std::str::from_utf8(&line) {
                on_line(text);
            }
        }
        total += read.consumed;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "clawdmeter-transcript-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn reply(id: &str, input: u64, output: u64) -> Reply {
        Reply {
            id: Some(id.to_owned()),
            model: "m".to_owned(),
            input,
            cache_read: 0,
            cache_creation: 0,
            output,
        }
    }

    #[test]
    fn a_repeated_id_only_adds_what_grew() {
        let mut run = RunCounts::default();
        assert_eq!(run.absorb(&reply("a", 10, 1)), (false, [10, 0, 0, 1]));
        assert_eq!(run.absorb(&reply("a", 10, 5)), (true, [0, 0, 0, 4]));
        assert_eq!(run.absorb(&reply("a", 10, 3)), (true, [0, 0, 0, 0]));
        assert_eq!(run.absorb(&reply("a", 12, 5)), (true, [2, 0, 0, 0]));
        assert_eq!(run.absorb(&reply("b", 1, 1)), (false, [1, 0, 0, 1]));
        let anonymous = Reply {
            id: None,
            ..reply("x", 2, 2)
        };
        assert_eq!(run.absorb(&anonymous), (false, [2, 0, 0, 2]));
        assert_eq!(run.absorb(&anonymous), (false, [2, 0, 0, 2]));
    }

    #[test]
    fn context_saturates() {
        let reply = Reply {
            cache_read: u64::MAX,
            ..reply("a", u64::MAX, 0)
        };
        assert_eq!(reply.context(), u64::MAX);
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_without_blocking() {
        let dir = scratch("fifo");
        let fifo = dir.join("pipe.jsonl");
        let name = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert!(read_lines_no_follow(&fifo, 0, 10, |_| {}).is_err());
        assert!(read_lines(&fifo, 0, 10, |_| {}).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn only_the_strict_reader_refuses_a_symlink() {
        let dir = scratch("link");
        let target = dir.join("real.jsonl");
        std::fs::write(&target, "one\ntwo\n").unwrap();
        let link = dir.join("link.jsonl");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let mut lines = Vec::new();
        assert!(read_lines_no_follow(&link, 0, 8, |line| lines.push(line.to_owned())).is_err());
        assert!(lines.is_empty());
        assert_eq!(
            read_lines(&link, 0, 8, |line| lines.push(line.to_owned())).unwrap(),
            8
        );
        assert_eq!(lines, vec!["one", "two"]);
        assert_eq!(read_lines_no_follow(&target, 0, 8, |_| {}).unwrap(), 8);
    }
}
