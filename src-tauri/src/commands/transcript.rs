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
        self.input + self.cache_read + self.cache_creation
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

pub fn read_lines(
    path: &Path,
    from: u64,
    to: u64,
    mut on_line: impl FnMut(&str),
) -> std::io::Result<u64> {
    let mut file = File::open(path)?;
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
