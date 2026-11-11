use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};
use super::home::home_dir;

const MAX_TRACKED_FILES: usize = 256;
const MAX_SUBAGENTS: usize = 50;
const SYNTHETIC_MODEL: &str = "<synthetic>";
const READ_BUFFER: usize = 64 * 1024;
const MAX_LINE: usize = 1024 * 1024;
const SUBAGENT_IDLE_LIMIT: Duration = Duration::from_secs(30 * 60);

#[derive(Default, Clone)]
struct Tally {
    offset: u64,
    first_timestamp: Option<String>,
    model: Option<String>,
    context_tokens: Option<u64>,
    long_context: bool,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_creation_tokens: u64,
    last_message_id: Option<String>,
    last_used: u64,
}

#[derive(Default)]
struct Store {
    tick: u64,
    tallies: HashMap<PathBuf, Tally>,
}

#[derive(Default, Clone)]
pub struct TranscriptTallies(Arc<Mutex<Store>>);

#[derive(Deserialize, Default)]
#[serde(default)]
struct Entry {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    message: Option<Message>,
    params: Option<Params>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Message {
    id: Option<String>,
    model: Option<String>,
    usage: Option<Usage>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Usage {
    input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Params {
    betas: Option<Vec<String>>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct SubagentMeta {
    agent_type: Option<String>,
    model: Option<String>,
    finished: Option<bool>,
    stopped_by_user: Option<bool>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubagentUsage {
    pub id: String,
    pub agent_type: Option<String>,
    pub model: Option<String>,
    pub started_at: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub model: Option<String>,
    pub context_tokens: Option<u64>,
    pub long_context: bool,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub subagents: Vec<SubagentUsage>,
}

fn invalid(message: &str) -> CommandError {
    CommandError::new(ErrorKind::InvalidArgument, message)
}

fn is_session_id(value: &str) -> bool {
    value.len() == 36 && value.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

pub fn project_dir_name(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|s| !s.is_empty())
}

fn apply_line(tally: &mut Tally, line: &str) {
    if !line.contains("\"usage\"")
        && !line.contains("\"api-request\"")
        && tally.first_timestamp.is_some()
    {
        return;
    }
    let Ok(entry) = serde_json::from_str::<Entry>(line) else {
        return;
    };
    if tally.first_timestamp.is_none() {
        tally.first_timestamp = non_empty(entry.timestamp);
    }
    match entry.kind.as_deref() {
        Some("assistant") => {
            if let Some(message) = entry.message {
                apply_assistant(tally, message);
            }
        }
        Some("api-request") => {
            let betas = entry.params.and_then(|params| params.betas);
            tally.long_context =
                betas.is_some_and(|betas| betas.iter().any(|beta| beta.starts_with("context-1m")));
        }
        _ => {}
    }
}

fn apply_assistant(tally: &mut Tally, message: Message) {
    let Some(usage) = message.usage else {
        return;
    };
    let Some(model) = non_empty(message.model) else {
        return;
    };
    // Written on API errors and interrupts with every counter at zero; it says nothing about the context.
    if model == SYNTHETIC_MODEL {
        return;
    }
    tally.model = Some(model);
    let input = usage.input_tokens.unwrap_or(0);
    let cache_read = usage.cache_read_input_tokens.unwrap_or(0);
    let cache_creation = usage.cache_creation_input_tokens.unwrap_or(0);
    tally.context_tokens = Some(input + cache_read + cache_creation);
    // One API response is written as one line per content block, all carrying the same usage.
    let id = non_empty(message.id);
    if id.is_some() && id == tally.last_message_id {
        return;
    }
    tally.last_message_id = id;
    tally.input_tokens += input;
    tally.cache_read_tokens += cache_read;
    tally.cache_creation_tokens += cache_creation;
    tally.output_tokens += usage.output_tokens.unwrap_or(0);
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

fn advance(tally: &mut Tally, path: &Path) -> std::io::Result<()> {
    if !std::fs::metadata(path)?.is_file() {
        return Err(std::io::Error::other("not a regular file"));
    }
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len < tally.offset {
        *tally = Tally::default();
    }
    if len == tally.offset {
        return Ok(());
    }
    file.seek(SeekFrom::Start(tally.offset))?;
    let mut reader = BufReader::with_capacity(READ_BUFFER, file.take(len - tally.offset));
    let mut line = Vec::new();
    loop {
        let read = next_line(&mut reader, &mut line)?;
        if !read.complete {
            return Ok(());
        }
        if !read.oversized {
            if let Ok(text) = std::str::from_utf8(&line) {
                apply_line(tally, text);
            }
        }
        tally.offset += read.consumed;
    }
}

impl TranscriptTallies {
    fn lock(&self) -> std::sync::MutexGuard<'_, Store> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn read(&self, path: &Path) -> Option<Tally> {
        let start = {
            let mut store = self.lock();
            store.tick += 1;
            let tick = store.tick;
            store
                .tallies
                .get_mut(path)
                .map_or_else(Tally::default, |tally| {
                    tally.last_used = tick;
                    tally.clone()
                })
        };
        let mut tally = start.clone();
        let result = advance(&mut tally, path);
        let mut store = self.lock();
        // Another read may have moved this file on meanwhile; its state is as valid as ours, so keep it.
        let untouched = store
            .tallies
            .get(path)
            .map_or(true, |stored| stored.offset == start.offset);
        match result {
            Ok(()) => {
                if untouched {
                    store.tick += 1;
                    tally.last_used = store.tick;
                    store.insert(path, tally.clone());
                }
                Some(tally)
            }
            Err(_) => {
                if untouched {
                    store.tallies.remove(path);
                }
                None
            }
        }
    }
}

impl Store {
    fn insert(&mut self, path: &Path, tally: Tally) {
        if !self.tallies.contains_key(path) && self.tallies.len() >= MAX_TRACKED_FILES {
            let oldest = self
                .tallies
                .iter()
                .min_by_key(|(_, tally)| tally.last_used)
                .map(|(path, _)| path.clone());
            if let Some(oldest) = oldest {
                self.tallies.remove(&oldest);
            }
        }
        self.tallies.insert(path.to_path_buf(), tally);
    }
}

fn idle_too_long(paths: &[PathBuf]) -> bool {
    let modified = paths.iter().find_map(|path| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
    });
    modified
        .and_then(|at| at.elapsed().ok())
        .is_some_and(|age| age > SUBAGENT_IDLE_LIMIT)
}

fn active_subagents(tallies: &TranscriptTallies, dir: &Path) -> Vec<SubagentUsage> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut subagents: Vec<SubagentUsage> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let id = name.strip_suffix(".meta.json")?.to_owned();
            let meta: SubagentMeta =
                serde_json::from_slice(&std::fs::read(entry.path()).ok()?).ok()?;
            if meta.finished == Some(true) || meta.stopped_by_user == Some(true) {
                return None;
            }
            let transcript = dir.join(format!("{id}.jsonl"));
            if idle_too_long(&[transcript.clone(), entry.path()]) {
                return None;
            }
            let tally = tallies.read(&transcript).unwrap_or_default();
            Some(SubagentUsage {
                agent_type: non_empty(meta.agent_type),
                model: tally.model.or_else(|| non_empty(meta.model)),
                started_at: tally.first_timestamp,
                id,
            })
        })
        .collect();
    subagents.sort_by(|a, b| {
        a.started_at
            .cmp(&b.started_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    subagents.truncate(MAX_SUBAGENTS);
    subagents
}

pub fn read_session_usage(
    tallies: &TranscriptTallies,
    projects: &Path,
    session_id: &str,
    cwd: &str,
) -> CommandResult<Option<SessionUsage>> {
    if !is_session_id(session_id) {
        return Err(invalid("invalid session id"));
    }
    if cwd.is_empty() {
        return Err(invalid("invalid cwd"));
    }
    let project = projects.join(project_dir_name(cwd));
    let Some(tally) = tallies.read(&project.join(format!("{session_id}.jsonl"))) else {
        return Ok(None);
    };
    Ok(Some(SessionUsage {
        model: tally.model,
        context_tokens: tally.context_tokens,
        long_context: tally.long_context,
        input_tokens: tally.input_tokens,
        output_tokens: tally.output_tokens,
        cache_read_tokens: tally.cache_read_tokens,
        cache_creation_tokens: tally.cache_creation_tokens,
        subagents: active_subagents(tallies, &project.join(session_id).join("subagents")),
    }))
}

#[tauri::command]
pub async fn session_usage(
    session_id: String,
    cwd: String,
    tallies: State<'_, TranscriptTallies>,
) -> CommandResult<Option<SessionUsage>> {
    let tallies = tallies.inner().clone();
    run_blocking(move || {
        let Some(home) = home_dir() else {
            return Ok(None);
        };
        read_session_usage(
            &tallies,
            &home.join(".claude").join("projects"),
            &session_id,
            &cwd,
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SESSION: &str = "11cb0a13-72c7-4d3e-9e35-eedfed0368f1";

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("clawdmeter-usage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn assistant(
        id: &str,
        model: &str,
        input: u64,
        read: u64,
        created: u64,
        output: u64,
    ) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"2026-11-10T14:00:00Z","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":{input},"cache_read_input_tokens":{read},"cache_creation_input_tokens":{created},"output_tokens":{output}}},"content":[{{"type":"text","text":"secret"}}]}}}}"#
        )
    }

    fn append(path: &Path, lines: &[String]) {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
    }

    fn setup(name: &str) -> (PathBuf, PathBuf) {
        let projects = scratch(name);
        let project = projects.join(project_dir_name("/Users/dev/my.repo"));
        std::fs::create_dir_all(project.join(SESSION).join("subagents")).unwrap();
        (projects, project)
    }

    #[test]
    fn maps_cwd_to_the_project_folder_name() {
        assert_eq!(
            project_dir_name("/Users/dev/Mottu/clawdmeter"),
            "-Users-dev-Mottu-clawdmeter"
        );
        assert_eq!(project_dir_name("/a/my.repo_x"), "-a-my-repo-x");
        assert_eq!(project_dir_name(r"C:\Users\dev"), "C--Users-dev");
    }

    #[test]
    fn rejects_a_session_id_that_could_escape_the_folder() {
        let tallies = TranscriptTallies::default();
        let projects = scratch("reject");
        let result = read_session_usage(
            &tallies,
            &projects,
            "../../etc/passwd-xxxxxxxxxxxxxxxxxxxx",
            "/x",
        );
        assert!(result.is_err());
    }

    #[test]
    fn missing_transcript_is_none() {
        let tallies = TranscriptTallies::default();
        let projects = scratch("missing");
        assert_eq!(
            read_session_usage(&tallies, &projects, SESSION, "/nowhere").unwrap(),
            None
        );
    }

    #[test]
    fn sums_usage_once_per_message_and_takes_context_from_the_last_reply() {
        let (projects, project) = setup("sum");
        let transcript = project.join(format!("{SESSION}.jsonl"));
        append(
            &transcript,
            &[
                r#"{"type":"user","timestamp":"2026-11-10T13:59:00Z","message":{"content":"hi"}}"#
                    .to_owned(),
                assistant("m1", "claude-opus-5-5", 10, 100, 5, 7),
                assistant("m1", "claude-opus-5-5", 10, 100, 5, 7),
                assistant("m2", "claude-opus-5-5", 2, 300, 1, 3),
                assistant("m3", "<synthetic>", 0, 0, 0, 0),
            ],
        );
        let tallies = TranscriptTallies::default();
        let usage = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        assert_eq!(usage.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(usage.context_tokens, Some(303));
        assert_eq!(usage.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(
            (
                usage.input_tokens,
                usage.cache_read_tokens,
                usage.cache_creation_tokens,
                usage.output_tokens
            ),
            (12, 400, 6, 10)
        );
        assert!(!usage.long_context);
        let json = serde_json::to_string(&usage).unwrap();
        assert!(!json.contains("secret"));
    }

    #[test]
    fn reads_only_what_was_appended_and_skips_a_partial_last_line() {
        let (projects, project) = setup("incremental");
        let transcript = project.join(format!("{SESSION}.jsonl"));
        append(
            &transcript,
            &[assistant("m1", "claude-opus-5-5", 1, 0, 0, 1)],
        );
        std::fs::OpenOptions::new()
            .append(true)
            .open(&transcript)
            .unwrap()
            .write_all(b"{\"type\":\"assist")
            .unwrap();
        let tallies = TranscriptTallies::default();
        let first = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        assert_eq!(first.input_tokens, 1);
        let offset = tallies.lock().tallies.values().next().unwrap().offset;
        assert_eq!(
            offset,
            std::fs::read(&transcript)
                .unwrap()
                .iter()
                .position(|&b| b == b'\n')
                .unwrap() as u64
                + 1
        );
        std::fs::write(
            &transcript,
            [std::fs::read(&transcript).unwrap(), b"ant\"}\n".to_vec()].concat(),
        )
        .unwrap();
        append(
            &transcript,
            &[assistant("m2", "claude-sonnet-5-5", 4, 0, 0, 2)],
        );
        let second = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        assert_eq!((second.input_tokens, second.output_tokens), (5, 3));
        assert_eq!(second.model.as_deref(), Some("claude-sonnet-5-5"));
    }

    fn padded_assistant(id: &str, input: u64, padding: usize) -> String {
        assistant(id, "claude-opus-5-5", input, 0, 0, 1).replace("secret", &"x".repeat(padding))
    }

    #[test]
    fn reads_lines_larger_than_the_buffer_and_rereads_a_partial_tail() {
        let (projects, project) = setup("large-lines");
        let transcript = project.join(format!("{SESSION}.jsonl"));
        let big = padded_assistant("m1", 3, READ_BUFFER * 3);
        let oversized = padded_assistant("m2", 1000, MAX_LINE);
        append(
            &transcript,
            &[
                big.clone(),
                oversized.clone(),
                padded_assistant("m3", 4, 10),
            ],
        );
        let partial = padded_assistant("m4", 5, READ_BUFFER * 2);
        let (head, tail) = partial.split_at(READ_BUFFER + 7);
        std::fs::OpenOptions::new()
            .append(true)
            .open(&transcript)
            .unwrap()
            .write_all(head.as_bytes())
            .unwrap();
        let tallies = TranscriptTallies::default();
        let first = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        assert_eq!(first.input_tokens, 7);
        let offset = tallies.lock().tallies.values().next().unwrap().offset;
        assert_eq!(
            offset,
            (big.len() + oversized.len() + padded_assistant("m3", 4, 10).len() + 3) as u64
        );
        std::fs::OpenOptions::new()
            .append(true)
            .open(&transcript)
            .unwrap()
            .write_all(format!("{tail}\n").as_bytes())
            .unwrap();
        let second = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        assert_eq!(second.input_tokens, 12);
        assert_eq!(second.context_tokens, Some(5));
    }

    #[test]
    fn concurrent_reads_of_the_same_transcript_agree() {
        let (projects, project) = setup("concurrent");
        let transcript = project.join(format!("{SESSION}.jsonl"));
        let lines: Vec<String> = (0..2000)
            .map(|i| padded_assistant(&format!("m{i}"), 1, 200))
            .collect();
        append(&transcript, &lines);
        let tallies = TranscriptTallies::default();
        let totals: Vec<u64> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
                            .unwrap()
                            .unwrap()
                            .input_tokens
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert!(totals.iter().all(|&total| total == 2000));
        append(&transcript, &[padded_assistant("last", 1, 10)]);
        let after = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        assert_eq!(after.input_tokens, 2001);
    }

    #[test]
    fn starts_over_when_the_transcript_shrinks() {
        let (projects, project) = setup("shrink");
        let transcript = project.join(format!("{SESSION}.jsonl"));
        append(
            &transcript,
            &[
                assistant("m1", "a", 50, 0, 0, 0),
                assistant("m2", "a", 50, 0, 0, 0),
            ],
        );
        let tallies = TranscriptTallies::default();
        read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo").unwrap();
        std::fs::write(
            &transcript,
            format!("{}\n", assistant("m3", "b", 1, 0, 0, 0)),
        )
        .unwrap();
        let usage = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        assert_eq!(usage.input_tokens, 1);
    }

    #[test]
    fn detects_the_one_million_context_beta() {
        let (projects, project) = setup("long");
        append(
            &project.join(format!("{SESSION}.jsonl")),
            &[r#"{"type":"api-request","timestamp":"t","params":{"model":"m","betas":["context-1m-2025-08-07"]}}"#.to_owned()],
        );
        let tallies = TranscriptTallies::default();
        assert!(
            read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
                .unwrap()
                .unwrap()
                .long_context
        );
    }

    #[test]
    fn evicts_the_least_recently_used_transcript_instead_of_clearing_all() {
        let dir = scratch("evict");
        let tallies = TranscriptTallies::default();
        let busy = dir.join("busy.jsonl");
        append(&busy, &[assistant("m1", "claude-opus-5-5", 1, 0, 0, 1)]);
        tallies.read(&busy).unwrap();
        let others: Vec<PathBuf> = (0..MAX_TRACKED_FILES)
            .map(|i| {
                let path = dir.join(format!("other-{i}.jsonl"));
                append(&path, &[assistant("m", "claude-opus-5-5", 1, 0, 0, 1)]);
                path
            })
            .collect();
        for path in &others[..MAX_TRACKED_FILES - 1] {
            tallies.read(path).unwrap();
            tallies.read(&busy).unwrap();
        }
        tallies.read(&others[MAX_TRACKED_FILES - 1]).unwrap();
        let store = tallies.lock();
        assert_eq!(store.tallies.len(), MAX_TRACKED_FILES);
        assert!(store
            .tallies
            .get(&busy)
            .is_some_and(|tally| tally.offset > 0));
        assert!(!store.tallies.contains_key(&others[0]));
        assert!(store.tallies.contains_key(&others[MAX_TRACKED_FILES - 1]));
    }

    #[test]
    fn a_path_that_is_not_a_regular_file_has_no_data() {
        let (projects, project) = setup("not-a-file");
        std::fs::create_dir_all(project.join(format!("{SESSION}.jsonl"))).unwrap();
        let tallies = TranscriptTallies::default();
        assert_eq!(
            read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo").unwrap(),
            None
        );
    }

    fn age(path: &Path, by: Duration) {
        let file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        file.set_modified(std::time::SystemTime::now() - by)
            .unwrap();
    }

    #[test]
    fn drops_subagents_stopped_by_the_user_or_idle_for_more_than_thirty_minutes() {
        let (projects, project) = setup("stale-subagents");
        append(
            &project.join(format!("{SESSION}.jsonl")),
            &[assistant("m1", "claude-opus-5-5", 1, 0, 0, 1)],
        );
        let subagents = project.join(SESSION).join("subagents");
        let meta = |id: &str, body: &str| {
            std::fs::write(subagents.join(format!("{id}.meta.json")), body).unwrap()
        };
        meta(
            "agent-stopped",
            r#"{"agentType":"Explore","stoppedByUser":true}"#,
        );
        meta("agent-stale", r#"{"agentType":"Explore"}"#);
        append(
            &subagents.join("agent-stale.jsonl"),
            &[assistant("s1", "claude-haiku-5-5", 1, 0, 0, 1)],
        );
        age(
            &subagents.join("agent-stale.jsonl"),
            Duration::from_secs(31 * 60),
        );
        meta("agent-stale-meta-only", r#"{"agentType":"Plan"}"#);
        age(
            &subagents.join("agent-stale-meta-only.meta.json"),
            Duration::from_secs(45 * 60),
        );
        meta("agent-recent", r#"{"agentType":"general-purpose"}"#);
        age(
            &subagents.join("agent-recent.meta.json"),
            Duration::from_secs(60 * 60),
        );
        append(
            &subagents.join("agent-recent.jsonl"),
            &[assistant("s2", "claude-sonnet-5-5", 1, 0, 0, 1)],
        );
        age(
            &subagents.join("agent-recent.jsonl"),
            Duration::from_secs(29 * 60),
        );
        let tallies = TranscriptTallies::default();
        let usage = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        let ids: Vec<&str> = usage.subagents.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["agent-recent"]);
    }

    #[test]
    fn lists_only_unfinished_subagents_with_type_model_and_start() {
        let (projects, project) = setup("subagents");
        append(
            &project.join(format!("{SESSION}.jsonl")),
            &[assistant("m1", "claude-opus-5-5", 1, 0, 0, 1)],
        );
        let subagents = project.join(SESSION).join("subagents");
        std::fs::write(
            subagents.join("agent-a.meta.json"),
            r#"{"agentType":"general-purpose","model":"sonnet"}"#,
        )
        .unwrap();
        append(
            &subagents.join("agent-a.jsonl"),
            &[
                r#"{"type":"user","timestamp":"2026-11-10T15:00:00.000Z","message":{"content":"go"}}"#.to_owned(),
                assistant("s1", "claude-sonnet-5-5", 1, 0, 0, 1),
            ],
        );
        std::fs::write(
            subagents.join("agent-b.meta.json"),
            r#"{"agentType":"Explore","finished":true}"#,
        )
        .unwrap();
        std::fs::write(
            subagents.join("agent-c.meta.json"),
            r#"{"agentType":"claude","model":"opus"}"#,
        )
        .unwrap();
        let tallies = TranscriptTallies::default();
        let usage = read_session_usage(&tallies, &projects, SESSION, "/Users/dev/my.repo")
            .unwrap()
            .unwrap();
        assert_eq!(
            usage.subagents,
            vec![
                SubagentUsage {
                    id: "agent-c".into(),
                    agent_type: Some("claude".into()),
                    model: Some("opus".into()),
                    started_at: None
                },
                SubagentUsage {
                    id: "agent-a".into(),
                    agent_type: Some("general-purpose".into()),
                    model: Some("claude-sonnet-5-5".into()),
                    started_at: Some("2026-11-10T15:00:00.000Z".into()),
                },
            ]
        );
    }
}
