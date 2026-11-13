use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};
use super::home::home_dir;
use super::transcript::{assistant_reply, read_lines_no_follow, Entry, RunCounts, MAX_LINE};

const MAX_DAYS: usize = 30;
const MAX_TRACKED_FILES: usize = 4096;
const MAX_MODEL_ID: usize = 80;
const UNKNOWN_MODEL: &str = "unknown";
const SCAN_BUDGET: u64 = 1024 * 1024 * 1024;
const MIN_DAY_SECS: i64 = 22 * 3_600;
const MAX_DAY_SECS: i64 = 26 * 3_600;
const MAX_PAST_SECS: i64 = 32 * 86_400;
const MAX_FUTURE_SECS: i64 = 3 * 86_400;

struct Event {
    at: i64,
    model: u32,
    tokens: u64,
    context: Option<u64>,
}

#[derive(Default)]
struct FileState {
    offset: u64,
    run: RunCounts,
    last_event_at: Option<i64>,
    events: Vec<Event>,
}

#[derive(Default)]
struct Store {
    covered_from: Option<i64>,
    models: Vec<String>,
    model_ids: HashMap<String, u32>,
    files: HashMap<PathBuf, FileState>,
    bytes_read: u64,
}

#[derive(Default, Clone)]
pub struct DailyTallies(Arc<Mutex<Store>>);

struct Candidate {
    path: PathBuf,
    session: String,
    main: bool,
    len: u64,
    modified: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelTokens {
    pub model: String,
    pub tokens: u64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayUsage {
    pub start: i64,
    pub models: Vec<ModelTokens>,
    pub sessions: u32,
    pub context_peaks: Vec<u64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub complete: bool,
    pub truncated: bool,
    pub days: Vec<DayUsage>,
}

fn invalid(message: &str) -> CommandError {
    CommandError::new(ErrorKind::InvalidArgument, message)
}

fn is_session_id(value: &str) -> bool {
    value.len() == 36 && value.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted = (month + 9) % 12;
    let day_of_year = (153 * shifted + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn number(bytes: &[u8]) -> Option<i64> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(bytes).ok()?.parse().ok()
}

fn parse_timestamp(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let (year, month, day) = (
        number(&bytes[0..4])?,
        number(&bytes[5..7])?,
        number(&bytes[8..10])?,
    );
    let (hour, minute, second) = (
        number(&bytes[11..13])?,
        number(&bytes[14..16])?,
        number(&bytes[17..19])?,
    );
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut rest = &bytes[19..];
    if rest.first() == Some(&b'.') {
        let digits = rest[1..].iter().take_while(|b| b.is_ascii_digit()).count();
        if digits == 0 {
            return None;
        }
        rest = &rest[1 + digits..];
    }
    let offset = match rest {
        [b'Z'] => 0,
        [sign @ (b'+' | b'-'), h1, h2, b':', m1, m2] => {
            let minutes = number(&[*h1, *h2])? * 60 + number(&[*m1, *m2])?;
            if *sign == b'+' {
                minutes * 60
            } else {
                -minutes * 60
            }
        }
        _ => return None,
    };
    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second - offset)
}

fn model_id(raw: String) -> String {
    let plain = !raw.is_empty()
        && raw.len() <= MAX_MODEL_ID
        && raw.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '/' | '[' | ']' | '@')
        });
    if plain {
        raw
    } else {
        UNKNOWN_MODEL.to_owned()
    }
}

impl Store {
    fn intern(&mut self, model: String) -> u32 {
        if let Some(index) = self.model_ids.get(&model) {
            return *index;
        }
        let index = self.models.len() as u32;
        self.models.push(model.clone());
        self.model_ids.insert(model, index);
        index
    }

    fn start_window(&mut self, since: i64) {
        match self.covered_from {
            Some(covered) if since < covered => self.files.clear(),
            Some(covered) if since > covered => {
                for state in self.files.values_mut() {
                    state.events.retain(|event| event.at >= since);
                }
            }
            _ => {}
        }
        self.covered_from = Some(since);
    }

    fn apply_line(&mut self, path: &Path, main: bool, since: i64, line: &str) {
        if !line.contains("\"usage\"") {
            return;
        }
        let Ok(entry) = serde_json::from_str::<Entry>(line) else {
            return;
        };
        if entry.kind.as_deref() != Some("assistant") {
            return;
        }
        let Some(at) = entry.timestamp.as_deref().and_then(parse_timestamp) else {
            return;
        };
        let Some(reply) = entry.message.and_then(assistant_reply) else {
            return;
        };
        let Some(state) = self.files.get_mut(path) else {
            return;
        };
        let (repeat, grown) = state.run.absorb(&reply);
        if repeat {
            let last = state.events.last_mut();
            if let Some(last) = last.filter(|last| Some(last.at) == state.last_event_at) {
                let extra = grown
                    .iter()
                    .fold(0u64, |sum, part| sum.saturating_add(*part));
                last.tokens = last.tokens.saturating_add(extra);
                last.context = last.context.map(|context| context.max(reply.context()));
            }
            return;
        }
        if at < since {
            state.last_event_at = None;
            return;
        }
        state.last_event_at = Some(at);
        let tokens = reply.context().saturating_add(reply.output);
        let context = main.then(|| reply.context());
        let model = self.intern(model_id(reply.model));
        if let Some(state) = self.files.get_mut(path) {
            state.events.push(Event {
                at,
                model,
                tokens,
                context,
            });
        }
    }

    fn refresh(&mut self, candidate: &Candidate, since: i64, budget: &mut u64) -> bool {
        let state = self.files.entry(candidate.path.clone()).or_default();
        if candidate.len < state.offset {
            *state = FileState::default();
        }
        if candidate.len == state.offset {
            return true;
        }
        let from = state.offset;
        let to = candidate.len.min(from.saturating_add(*budget));
        let outcome = read_lines_no_follow(&candidate.path, from, to, |line| {
            self.apply_line(&candidate.path, candidate.main, since, line);
        });
        match outcome {
            Ok(consumed) => {
                if let Some(state) = self.files.get_mut(&candidate.path) {
                    state.offset += consumed;
                }
                self.bytes_read += consumed;
                *budget = budget.saturating_sub(consumed);
                to == candidate.len
            }
            Err(_) => {
                self.files.remove(&candidate.path);
                true
            }
        }
    }
}

fn project_dirs(projects: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(projects) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect()
}

fn candidate(path: PathBuf, session: &str, main: bool, since: i64) -> Option<Candidate> {
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .map_or(0, |age| age.as_secs() as i64);
    if modified < since {
        return None;
    }
    Some(Candidate {
        path,
        session: session.to_owned(),
        main,
        len: meta.len(),
        modified,
    })
}

fn collect_project(project: &Path, since: i64, found: &mut Vec<Candidate>) {
    let Ok(entries) = std::fs::read_dir(project) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if kind.is_file() {
            let session = name.strip_suffix(".jsonl").filter(|id| is_session_id(id));
            if let Some(found_one) = session.and_then(|id| candidate(entry.path(), id, true, since))
            {
                found.push(found_one);
            }
        } else if kind.is_dir() && is_session_id(&name) {
            collect_subagents(&entry.path().join("subagents"), &name, since, found);
        }
    }
}

fn collect_subagents(dir: &Path, session: &str, since: i64, found: &mut Vec<Candidate>) {
    let is_real_dir = std::fs::symlink_metadata(dir).is_ok_and(|meta| meta.is_dir());
    if !is_real_dir {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if name.starts_with("agent-") && name.ends_with(".jsonl") {
            found.extend(candidate(entry.path(), session, false, since));
        }
    }
}

fn candidates(projects: &Path, since: i64) -> (Vec<Candidate>, bool) {
    let mut found = Vec::new();
    for project in project_dirs(projects) {
        collect_project(&project, since, &mut found);
    }
    found.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.path.cmp(&b.path))
    });
    let truncated = found.len() > MAX_TRACKED_FILES;
    found.truncate(MAX_TRACKED_FILES);
    (found, truncated)
}

fn validate(day_starts: &[i64], now: i64) -> CommandResult<()> {
    let count = day_starts.len();
    if !(2..=MAX_DAYS + 1).contains(&count) {
        return Err(invalid("invalid day range"));
    }
    let gaps_ok = day_starts
        .windows(2)
        .all(|pair| (MIN_DAY_SECS..=MAX_DAY_SECS).contains(&(pair[1] - pair[0])));
    if !gaps_ok {
        return Err(invalid("invalid day boundaries"));
    }
    if day_starts[0] < now - MAX_PAST_SECS || day_starts[count - 1] > now + MAX_FUTURE_SECS {
        return Err(invalid("day boundaries out of range"));
    }
    Ok(())
}

#[derive(Default)]
struct DayAccumulator {
    tokens: BTreeMap<u32, u64>,
    sessions: HashSet<String>,
    peaks: HashMap<String, u64>,
}

fn aggregate(
    store: &Store,
    found: &[Candidate],
    day_starts: &[i64],
    complete: bool,
    truncated: bool,
) -> DailyUsage {
    let days = day_starts.len() - 1;
    let mut accumulators: Vec<DayAccumulator> =
        (0..days).map(|_| DayAccumulator::default()).collect();
    for item in found {
        let Some(state) = store.files.get(&item.path) else {
            continue;
        };
        for event in &state.events {
            let upper = day_starts.partition_point(|start| *start <= event.at);
            if upper == 0 || upper > days {
                continue;
            }
            let day = &mut accumulators[upper - 1];
            let total = day.tokens.entry(event.model).or_default();
            *total = total.saturating_add(event.tokens);
            day.sessions.insert(item.session.clone());
            if let Some(context) = event.context {
                let peak = day.peaks.entry(item.session.clone()).or_default();
                *peak = (*peak).max(context);
            }
        }
    }
    let days = accumulators
        .into_iter()
        .zip(day_starts)
        .map(|(day, start)| {
            let mut models: Vec<ModelTokens> = day
                .tokens
                .into_iter()
                .map(|(index, tokens)| ModelTokens {
                    model: store.models[index as usize].clone(),
                    tokens,
                })
                .collect();
            models.sort_by(|a, b| b.tokens.cmp(&a.tokens).then_with(|| a.model.cmp(&b.model)));
            let mut context_peaks: Vec<u64> = day.peaks.into_values().collect();
            context_peaks.sort_unstable_by(|a, b| b.cmp(a));
            DayUsage {
                start: *start,
                models,
                sessions: day.sessions.len() as u32,
                context_peaks,
            }
        })
        .collect();
    DailyUsage {
        complete,
        truncated,
        days,
    }
}

fn scan(
    tallies: &DailyTallies,
    projects: &Path,
    day_starts: &[i64],
    now: i64,
    mut budget: u64,
) -> CommandResult<DailyUsage> {
    validate(day_starts, now)?;
    let since = day_starts[0];
    // The folder walk happens under the lock so a concurrent call never sees stale lengths.
    let mut store = tallies
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (found, truncated) = candidates(projects, since);
    store.start_window(since);
    let kept: HashSet<&PathBuf> = found.iter().map(|item| &item.path).collect();
    store.files.retain(|path, _| kept.contains(path));
    let mut complete = true;
    for item in &found {
        if budget < 2 * MAX_LINE as u64 {
            complete &= store
                .files
                .get(&item.path)
                .map_or(item.len == 0, |state| state.offset >= item.len);
            continue;
        }
        complete &= store.refresh(item, since, &mut budget);
    }
    Ok(aggregate(&store, &found, day_starts, complete, truncated))
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |age| age.as_secs() as i64)
}

#[tauri::command]
pub async fn daily_usage(
    day_starts: Vec<i64>,
    tallies: State<'_, DailyTallies>,
) -> CommandResult<Option<DailyUsage>> {
    let tallies = tallies.inner().clone();
    run_blocking(move || {
        let Some(home) = home_dir() else {
            return Ok(None);
        };
        let projects = home.join(".claude").join("projects");
        scan(&tallies, &projects, &day_starts, unix_now(), SCAN_BUDGET).map(Some)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::Duration;

    const SESSION: &str = "11cb0a13-72c7-4d3e-9e35-eedfed0368f1";
    const OTHER: &str = "22cb0a13-72c7-4d3e-9e35-eedfed0368f2";
    const BUDGET: u64 = 8 * 1024 * 1024;

    fn at(text: &str) -> i64 {
        parse_timestamp(text).unwrap()
    }

    fn now() -> i64 {
        at("2026-11-13T15:00:00Z")
    }

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("clawdmeter-daily-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn boundaries() -> Vec<i64> {
        [
            "2026-11-09T03:00:00Z",
            "2026-11-10T03:00:00Z",
            "2026-11-11T03:00:00Z",
            "2026-11-12T03:00:00Z",
            "2026-11-13T03:00:00Z",
        ]
        .map(at)
        .to_vec()
    }

    fn reply(
        stamp: &str,
        id: &str,
        model: &str,
        input: u64,
        read: u64,
        created: u64,
        output: u64,
    ) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{stamp}","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":{input},"cache_read_input_tokens":{read},"cache_creation_input_tokens":{created},"output_tokens":{output}}},"content":[{{"type":"text","text":"secret"}}]}}}}"#
        )
    }

    fn set_mtime(path: &Path, secs: i64) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(UNIX_EPOCH + Duration::from_secs(secs as u64))
            .unwrap();
    }

    fn append_raw(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        file.write_all(text.as_bytes()).unwrap();
        drop(file);
        set_mtime(path, at("2026-11-12T12:00:00Z"));
    }

    fn append(path: &Path, lines: &[String]) {
        let text: String = lines.iter().map(|line| format!("{line}\n")).collect();
        append_raw(path, &text);
    }

    fn main_file(projects: &Path, session: &str) -> PathBuf {
        projects.join("-work-repo").join(format!("{session}.jsonl"))
    }

    fn subagent_file(projects: &Path, session: &str, name: &str) -> PathBuf {
        projects
            .join("-work-repo")
            .join(session)
            .join("subagents")
            .join(format!("{name}.jsonl"))
    }

    fn run(tallies: &DailyTallies, projects: &Path) -> DailyUsage {
        scan(tallies, projects, &boundaries(), now(), BUDGET).unwrap()
    }

    fn tokens_of(day: &DayUsage, model: &str) -> u64 {
        day.models
            .iter()
            .find(|entry| entry.model == model)
            .map_or(0, |entry| entry.tokens)
    }

    fn bytes_read(tallies: &DailyTallies) -> u64 {
        tallies.0.lock().unwrap().bytes_read
    }

    #[test]
    fn parses_utc_fractional_and_offset_timestamps() {
        assert_eq!(at("1970-01-01T00:00:00Z"), 0);
        assert_eq!(at("2026-11-10T14:00:00.123Z"), at("2026-11-10T14:00:00Z"));
        assert_eq!(at("2026-11-10T11:00:00-03:00"), at("2026-11-10T14:00:00Z"));
        assert_eq!(at("2026-11-10T16:30:00+02:30"), at("2026-11-10T14:00:00Z"));
        assert_eq!(
            at("2024-03-01T00:00:00Z") - at("2024-02-28T00:00:00Z"),
            2 * 86_400
        );
        for bad in [
            "",
            "yesterday",
            "2026-11-10 14:00:00Z",
            "2026-13-10T14:00:00Z",
            "2026-11-10T25:00:00Z",
            "2026-11-10T14:00:00",
            "2026-11-10T14:00:00.Z",
            "2026-11-10T14:00:00+0300",
        ] {
            assert_eq!(parse_timestamp(bad), None, "{bad}");
        }
    }

    #[test]
    fn buckets_replies_by_the_local_day_across_midnight() {
        let projects = scratch("midnight");
        append(
            &main_file(&projects, SESSION),
            &[
                reply("2026-11-10T02:59:59Z", "a", "claude-opus-5", 1, 0, 0, 1),
                reply("2026-11-10T03:00:00Z", "b", "claude-opus-5", 10, 0, 0, 10),
                reply(
                    "2026-11-11T02:59:59.999Z",
                    "c",
                    "claude-opus-5",
                    100,
                    0,
                    0,
                    100,
                ),
                reply("2026-11-11T03:00:00Z", "f", "claude-opus-5", 1000, 0, 0, 0),
                reply("2026-11-08T12:00:00Z", "d", "claude-opus-5", 5000, 0, 0, 0),
                reply("2026-11-13T03:00:00Z", "e", "claude-opus-5", 7000, 0, 0, 0),
            ],
        );
        let usage = run(&DailyTallies::default(), &projects);
        assert!(usage.complete);
        let totals: Vec<u64> = usage
            .days
            .iter()
            .map(|day| tokens_of(day, "claude-opus-5"))
            .collect();
        assert_eq!(totals, vec![2, 220, 1000, 0]);
        assert_eq!(usage.days[1].start, at("2026-11-10T03:00:00Z"));
    }

    #[test]
    fn splits_tokens_by_model_and_sums_all_four_counters() {
        let projects = scratch("models");
        append(
            &main_file(&projects, SESSION),
            &[
                reply(
                    "2026-11-10T12:00:00Z",
                    "a",
                    "claude-opus-5",
                    1,
                    20,
                    300,
                    4000,
                ),
                reply("2026-11-10T12:05:00Z", "b", "claude-haiku-5", 1, 1, 1, 1),
                reply("2026-11-10T12:06:00Z", "c", "<synthetic>", 0, 0, 0, 0),
                reply("2026-11-10T12:07:00Z", "d", "not a model id", 2, 0, 0, 0),
            ],
        );
        let usage = run(&DailyTallies::default(), &projects);
        assert_eq!(
            usage.days[1].models,
            vec![
                ModelTokens {
                    model: "claude-opus-5".into(),
                    tokens: 4321
                },
                ModelTokens {
                    model: "claude-haiku-5".into(),
                    tokens: 4
                },
                ModelTokens {
                    model: "unknown".into(),
                    tokens: 2
                },
            ]
        );
    }

    #[test]
    fn counts_a_reply_once_even_when_it_spans_several_lines() {
        let projects = scratch("dedupe");
        let line = reply("2026-11-10T12:00:00Z", "a", "claude-opus-5", 1, 1, 1, 1);
        append(
            &main_file(&projects, SESSION),
            &[line.clone(), line.clone(), line],
        );
        let usage = run(&DailyTallies::default(), &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 4);
    }

    #[test]
    fn counts_subagent_tokens_without_adding_context() {
        let projects = scratch("subagents");
        append(
            &main_file(&projects, SESSION),
            &[reply(
                "2026-11-10T12:00:00Z",
                "a",
                "claude-opus-5",
                100,
                0,
                0,
                0,
            )],
        );
        append(
            &subagent_file(&projects, SESSION, "agent-1"),
            &[reply(
                "2026-11-10T12:01:00Z",
                "s1",
                "claude-haiku-5",
                9000,
                0,
                0,
                1,
            )],
        );
        append(
            &subagent_file(&projects, OTHER, "agent-2"),
            &[reply(
                "2026-11-10T12:02:00Z",
                "s2",
                "claude-haiku-5",
                1,
                0,
                0,
                0,
            )],
        );
        let usage = run(&DailyTallies::default(), &projects);
        let day = &usage.days[1];
        assert_eq!(tokens_of(day, "claude-haiku-5"), 9002);
        assert_eq!(tokens_of(day, "claude-opus-5"), 100);
        assert_eq!(day.sessions, 2);
        assert_eq!(day.context_peaks, vec![100]);
    }

    #[test]
    fn keeps_the_highest_context_of_each_session_per_day() {
        let projects = scratch("peaks");
        append(
            &main_file(&projects, SESSION),
            &[
                reply("2026-11-10T10:00:00Z", "a", "claude-opus-5", 10, 500, 5, 99),
                reply("2026-11-10T11:00:00Z", "b", "claude-opus-5", 1, 900, 0, 1),
                reply("2026-11-10T12:00:00Z", "c", "claude-opus-5", 1, 200, 0, 1),
                reply("2026-11-11T10:00:00Z", "d", "claude-opus-5", 1, 50, 0, 1),
            ],
        );
        append(
            &main_file(&projects, OTHER),
            &[reply(
                "2026-11-10T13:00:00Z",
                "e",
                "claude-opus-5",
                300,
                0,
                0,
                1,
            )],
        );
        let usage = run(&DailyTallies::default(), &projects);
        assert_eq!(usage.days[1].sessions, 2);
        assert_eq!(usage.days[1].context_peaks, vec![901, 300]);
        assert_eq!(usage.days[2].sessions, 1);
        assert_eq!(usage.days[2].context_peaks, vec![51]);
        assert_eq!(usage.days[0].sessions, 0);
        assert!(usage.days[0].context_peaks.is_empty());
    }

    #[test]
    fn second_call_reads_only_the_bytes_that_grew() {
        let projects = scratch("incremental");
        let path = main_file(&projects, SESSION);
        append(
            &path,
            &[reply(
                "2026-11-10T12:00:00Z",
                "a",
                "claude-opus-5",
                1,
                0,
                0,
                0,
            )],
        );
        let tallies = DailyTallies::default();
        let first = run(&tallies, &projects);
        let after_first = bytes_read(&tallies);
        assert_eq!(after_first, std::fs::metadata(&path).unwrap().len());
        assert_eq!(tokens_of(&first.days[1], "claude-opus-5"), 1);

        let unchanged = run(&tallies, &projects);
        assert_eq!(bytes_read(&tallies), after_first);
        assert_eq!(unchanged, first);

        let added = reply("2026-11-10T12:30:00Z", "b", "claude-opus-5", 20, 0, 0, 0);
        append(&path, std::slice::from_ref(&added));
        let second = run(&tallies, &projects);
        assert_eq!(bytes_read(&tallies) - after_first, added.len() as u64 + 1);
        assert_eq!(tokens_of(&second.days[1], "claude-opus-5"), 21);
    }

    #[test]
    fn leaves_a_half_written_last_line_for_the_next_call() {
        let projects = scratch("partial");
        let path = main_file(&projects, SESSION);
        let whole = reply("2026-11-10T12:00:00Z", "a", "claude-opus-5", 7, 0, 0, 0);
        let (head, tail) = whole.split_at(40);
        append_raw(&path, head);
        let tallies = DailyTallies::default();
        assert_eq!(
            tokens_of(&run(&tallies, &projects).days[1], "claude-opus-5"),
            0
        );
        append_raw(&path, &format!("{tail}\n"));
        assert_eq!(
            tokens_of(&run(&tallies, &projects).days[1], "claude-opus-5"),
            7
        );
    }

    #[test]
    fn starts_over_when_a_transcript_shrinks() {
        let projects = scratch("shrink");
        let path = main_file(&projects, SESSION);
        append(
            &path,
            &[
                reply("2026-11-10T12:00:00Z", "a", "claude-opus-5", 1000, 0, 0, 0),
                reply("2026-11-10T12:01:00Z", "b", "claude-opus-5", 1000, 0, 0, 0),
            ],
        );
        let tallies = DailyTallies::default();
        assert_eq!(
            tokens_of(&run(&tallies, &projects).days[1], "claude-opus-5"),
            2000
        );
        std::fs::remove_file(&path).unwrap();
        append(
            &path,
            &[reply(
                "2026-11-10T13:00:00Z",
                "c",
                "claude-opus-5",
                5,
                0,
                0,
                0,
            )],
        );
        assert_eq!(
            tokens_of(&run(&tallies, &projects).days[1], "claude-opus-5"),
            5
        );
    }

    #[test]
    fn skips_malformed_lines_and_unreadable_entries() {
        let projects = scratch("malformed");
        append(
            &main_file(&projects, SESSION),
            &[
                "not json at all \"usage\"".to_owned(),
                r#"{"type":"assistant","timestamp":"2026-11-10T12:00:00Z","message":{"usage":"broken"}}"#.to_owned(),
                r#"{"type":"assistant","timestamp":"soon","message":{"id":"x","model":"m","usage":{"input_tokens":50}}}"#.to_owned(),
                r#"{"type":"user","timestamp":"2026-11-10T12:00:00Z","message":{"usage":{"input_tokens":50}}}"#.to_owned(),
                reply("2026-11-10T12:00:00Z", "a", "claude-opus-5", 3, 0, 0, 0),
            ],
        );
        std::fs::create_dir_all(projects.join("-work-repo").join(format!("{OTHER}.jsonl")))
            .unwrap();
        let usage = run(&DailyTallies::default(), &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 3);
        assert_eq!(usage.days[1].sessions, 1);
    }

    #[test]
    fn does_not_open_files_last_modified_before_the_window() {
        let projects = scratch("stale");
        let stale = main_file(&projects, OTHER);
        append(
            &stale,
            &[reply(
                "2026-11-10T12:00:00Z",
                "z",
                "claude-opus-5",
                999,
                0,
                0,
                0,
            )],
        );
        set_mtime(&stale, at("2026-11-08T12:00:00Z"));
        let fresh = main_file(&projects, SESSION);
        append(
            &fresh,
            &[reply(
                "2026-11-10T12:00:00Z",
                "a",
                "claude-opus-5",
                1,
                0,
                0,
                0,
            )],
        );
        let tallies = DailyTallies::default();
        let usage = run(&tallies, &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 1);
        assert_eq!(
            bytes_read(&tallies),
            std::fs::metadata(&fresh).unwrap().len()
        );
        assert!(!tallies.0.lock().unwrap().files.contains_key(&stale));
    }

    #[test]
    fn ignores_files_that_are_not_transcripts() {
        let projects = scratch("names");
        append(
            &main_file(&projects, SESSION),
            &[reply(
                "2026-11-10T12:00:00Z",
                "a",
                "claude-opus-5",
                1,
                0,
                0,
                0,
            )],
        );
        let line = reply("2026-11-10T12:00:00Z", "z", "claude-opus-5", 500, 0, 0, 0);
        append(
            &projects.join("-work-repo").join("notes.jsonl"),
            std::slice::from_ref(&line),
        );
        append(&projects.join("loose.jsonl"), std::slice::from_ref(&line));
        append(
            &subagent_file(&projects, SESSION, "other-1"),
            std::slice::from_ref(&line),
        );
        append(
            &subagent_file(&projects, "not-a-session", "agent-1"),
            &[line],
        );
        let usage = run(&DailyTallies::default(), &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 1);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_follow_symlinks_out_of_the_projects_folder() {
        use std::os::unix::fs::symlink;
        let projects = scratch("symlinks");
        let outside = scratch("symlinks-outside");
        let line = reply("2026-11-10T12:00:00Z", "z", "claude-opus-5", 500, 0, 0, 0);
        append(&outside.join("leak.jsonl"), std::slice::from_ref(&line));
        append(&outside.join("agent-9.jsonl"), std::slice::from_ref(&line));
        append(
            &outside.join("-stolen").join(format!("{SESSION}.jsonl")),
            &[line],
        );
        append(
            &main_file(&projects, SESSION),
            &[reply(
                "2026-11-10T12:00:00Z",
                "a",
                "claude-opus-5",
                1,
                0,
                0,
                0,
            )],
        );
        symlink(outside.join("leak.jsonl"), main_file(&projects, OTHER)).unwrap();
        symlink(outside.join("-stolen"), projects.join("-linked-project")).unwrap();
        let session_dir = projects.join("-work-repo").join(SESSION);
        std::fs::create_dir_all(&session_dir).unwrap();
        symlink(&outside, session_dir.join("subagents")).unwrap();
        let other_dir = projects.join("-work-repo").join(OTHER);
        std::fs::create_dir_all(other_dir.join("subagents")).unwrap();
        symlink(
            outside.join("agent-9.jsonl"),
            other_dir.join("subagents").join("agent-9.jsonl"),
        )
        .unwrap();
        let usage = run(&DailyTallies::default(), &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 1);
        assert_eq!(usage.days[1].sessions, 1);
    }

    #[test]
    fn output_carries_only_numbers_and_model_ids() {
        let projects = scratch("privacy");
        append(
            &main_file(&projects, SESSION),
            &[reply(
                "2026-11-10T12:00:00Z",
                "msg-id-secret",
                "claude-opus-5",
                1,
                2,
                3,
                4,
            )],
        );
        let usage = run(&DailyTallies::default(), &projects);
        let json = serde_json::to_value(&usage).unwrap();
        let text = json.to_string();
        for leaked in ["secret", "work-repo", SESSION, "msg-id", "jsonl"] {
            assert!(!text.contains(leaked), "{leaked}");
        }
        let keys = |value: &serde_json::Value| {
            let mut keys: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
            keys.sort();
            keys
        };
        assert_eq!(keys(&json), vec!["complete", "days", "truncated"]);
        let day = &json["days"][1];
        assert_eq!(
            keys(day),
            vec!["contextPeaks", "models", "sessions", "start"]
        );
        assert_eq!(keys(&day["models"][0]), vec!["model", "tokens"]);
    }

    #[test]
    fn bounds_the_work_per_call_and_finishes_over_the_next_ones() {
        let projects = scratch("budget");
        let padding = "x".repeat(300 * 1024);
        let lines: Vec<String> = (0..24)
            .map(|n| {
                format!(
                    r#"{{"type":"assistant","timestamp":"2026-11-10T12:00:00Z","message":{{"id":"m{n}","model":"claude-opus-5","usage":{{"input_tokens":1}}}},"pad":"{padding}"}}"#
                )
            })
            .collect();
        let path = main_file(&projects, SESSION);
        append(&path, &lines);
        let size = std::fs::metadata(&path).unwrap().len();
        let budget = 3 * 1024 * 1024;
        assert!(size > 2 * budget);
        let tallies = DailyTallies::default();
        let mut passes = 0;
        let usage = loop {
            passes += 1;
            let usage = scan(&tallies, &projects, &boundaries(), now(), budget).unwrap();
            if usage.complete {
                break usage;
            }
            assert!(bytes_read(&tallies) <= passes * budget);
            assert!(passes < 20);
        };
        assert!(passes >= 3);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 24);
        assert_eq!(bytes_read(&tallies), size);
    }

    #[test]
    fn forgets_files_that_left_the_window_and_rescans_a_wider_one() {
        let projects = scratch("window");
        let path = main_file(&projects, SESSION);
        append(
            &path,
            &[
                reply("2026-11-09T12:00:00Z", "a", "claude-opus-5", 1, 0, 0, 0),
                reply("2026-11-10T12:00:00Z", "b", "claude-opus-5", 10, 0, 0, 0),
            ],
        );
        let tallies = DailyTallies::default();
        let narrow: Vec<i64> = boundaries()[1..].to_vec();
        let usage = scan(&tallies, &projects, &narrow, now(), BUDGET).unwrap();
        assert_eq!(usage.days.len(), 3);
        assert_eq!(tokens_of(&usage.days[0], "claude-opus-5"), 10);
        let wide = scan(&tallies, &projects, &boundaries(), now(), BUDGET).unwrap();
        assert_eq!(tokens_of(&wide.days[0], "claude-opus-5"), 1);
        assert_eq!(tokens_of(&wide.days[1], "claude-opus-5"), 10);
        set_mtime(&path, at("2026-11-01T00:00:00Z"));
        scan(&tallies, &projects, &boundaries(), now(), BUDGET).unwrap();
        assert!(tallies.0.lock().unwrap().files.is_empty());
    }

    #[test]
    fn missing_projects_folder_gives_empty_days() {
        let projects = scratch("empty").join("absent");
        let usage = run(&DailyTallies::default(), &projects);
        assert!(usage.complete);
        assert_eq!(usage.days.len(), 4);
        assert!(usage
            .days
            .iter()
            .all(|day| day.models.is_empty() && day.sessions == 0));
    }

    #[test]
    fn rejects_day_boundaries_that_make_no_sense() {
        let tallies = DailyTallies::default();
        let projects = scratch("invalid");
        for bad in [
            vec![],
            vec![at("2026-11-10T03:00:00Z")],
            vec![at("2026-11-10T03:00:00Z"), at("2026-11-10T03:00:00Z")],
            vec![at("2026-11-11T03:00:00Z"), at("2026-11-10T03:00:00Z")],
            vec![-5, 10],
            vec![1, 2],
            (0..40)
                .map(|n| at("2026-11-01T03:00:00Z") + n * 86_400)
                .collect(),
        ] {
            assert!(
                scan(&tallies, &projects, &bad, now(), BUDGET).is_err(),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn enforces_the_day_bound_in_rust() {
        let day = 86_400;
        let first = at("2026-11-10T03:00:00Z");
        let check = |starts: Vec<i64>| validate(&starts, now());
        assert!(check(vec![first, first + day]).is_ok());
        assert!(check(vec![first, first + 23 * 3_600, first + 48 * 3_600 - 3_600]).is_ok());
        assert!(check(vec![first, first + 25 * 3_600]).is_ok());
        assert!(check(vec![first, first + 21 * 3_600]).is_err());
        assert!(check(vec![first, first + 27 * 3_600]).is_err());
        assert!(check(vec![first, first + 3_600, first + day]).is_err());
        assert!(check(vec![now() - 40 * day, now() - 39 * day]).is_err());
        assert!(check(vec![now() + 5 * day, now() + 6 * day]).is_err());
        assert!(check(vec![now() - 31 * day, now() - 30 * day]).is_ok());
    }

    #[test]
    fn reports_when_more_files_than_the_cap_were_left_out() {
        let projects = scratch("truncated");
        let line = reply("2026-11-10T12:00:00Z", "a", "claude-opus-5", 1, 0, 0, 0);
        for n in 0..=MAX_TRACKED_FILES {
            let session = format!("{n:08x}-72c7-4d3e-9e35-eedfed0368f1");
            append(&main_file(&projects, &session), std::slice::from_ref(&line));
        }
        let tallies = DailyTallies::default();
        let usage = run(&tallies, &projects);
        assert!(usage.truncated);
        assert_eq!(tallies.0.lock().unwrap().files.len(), MAX_TRACKED_FILES);
        std::fs::remove_file(main_file(
            &projects,
            &format!("{:08x}-72c7-4d3e-9e35-eedfed0368f1", 0),
        ))
        .unwrap();
        assert!(!run(&DailyTallies::default(), &projects).truncated);
    }

    #[test]
    fn keeps_the_largest_counters_of_a_streamed_reply() {
        let projects = scratch("streamed");
        append(
            &main_file(&projects, SESSION),
            &[
                reply("2026-11-10T12:00:00Z", "a", "claude-opus-5", 10, 100, 0, 1),
                reply("2026-11-10T12:00:01Z", "a", "claude-opus-5", 10, 100, 0, 5),
                reply("2026-11-10T12:00:02Z", "a", "claude-opus-5", 10, 100, 0, 9),
                reply("2026-11-10T12:00:03Z", "a", "claude-opus-5", 10, 100, 0, 4),
                reply("2026-11-10T12:01:00Z", "b", "claude-opus-5", 1, 1, 1, 1),
            ],
        );
        let tallies = DailyTallies::default();
        let usage = run(&tallies, &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 119 + 4);
        assert_eq!(usage.days[1].context_peaks, vec![110]);
        append(
            &main_file(&projects, SESSION),
            &[reply(
                "2026-11-10T12:01:01Z",
                "b",
                "claude-opus-5",
                1,
                1,
                1,
                8,
            )],
        );
        let usage = run(&tallies, &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 119 + 4 + 7);
    }

    #[test]
    fn a_streamed_reply_before_the_window_never_leaks_into_it() {
        let projects = scratch("streamed-old");
        append(
            &main_file(&projects, SESSION),
            &[
                reply("2026-11-01T12:00:00Z", "old", "claude-opus-5", 500, 0, 0, 1),
                reply(
                    "2026-11-01T12:00:01Z",
                    "old",
                    "claude-opus-5",
                    500,
                    0,
                    0,
                    50,
                ),
                reply("2026-11-10T12:00:00Z", "new", "claude-opus-5", 7, 0, 0, 0),
            ],
        );
        let usage = run(&DailyTallies::default(), &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), 7);
    }

    #[test]
    fn hostile_counters_saturate_instead_of_overflowing() {
        let projects = scratch("saturate");
        let max = u64::MAX;
        append(
            &main_file(&projects, SESSION),
            &[
                reply(
                    "2026-11-10T12:00:00Z",
                    "a",
                    "claude-opus-5",
                    max,
                    max,
                    max,
                    max,
                ),
                reply("2026-11-10T12:01:00Z", "b", "claude-opus-5", max, 1, 1, 1),
            ],
        );
        let usage = run(&DailyTallies::default(), &projects);
        assert_eq!(tokens_of(&usage.days[1], "claude-opus-5"), max);
        assert_eq!(usage.days[1].context_peaks, vec![max]);
    }

    #[test]
    fn sliding_the_window_forward_prunes_old_events_without_reading_again() {
        let projects = scratch("slide");
        let path = main_file(&projects, SESSION);
        append(
            &path,
            &[
                reply("2026-11-09T12:00:00Z", "a", "claude-opus-5", 1, 0, 0, 0),
                reply("2026-11-10T12:00:00Z", "b", "claude-opus-5", 10, 0, 0, 0),
                reply("2026-11-11T12:00:00Z", "c", "claude-opus-5", 100, 0, 0, 0),
            ],
        );
        let tallies = DailyTallies::default();
        let wide = run(&tallies, &projects);
        assert_eq!(tokens_of(&wide.days[0], "claude-opus-5"), 1);
        let read = bytes_read(&tallies);
        let narrow: Vec<i64> = boundaries()[2..].to_vec();
        let usage = scan(&tallies, &projects, &narrow, now(), BUDGET).unwrap();
        assert_eq!(bytes_read(&tallies), read);
        assert_eq!(tokens_of(&usage.days[0], "claude-opus-5"), 100);
        let store = tallies.0.lock().unwrap();
        assert_eq!(store.covered_from, Some(narrow[0]));
        assert_eq!(store.files[&path].events.len(), 1);
    }

    #[test]
    fn concurrent_calls_agree_and_read_every_byte_once() {
        let projects = scratch("concurrent");
        let mut size = 0;
        for n in 0..24 {
            let session = format!("{n:08x}-72c7-4d3e-9e35-eedfed0368f1");
            let path = main_file(&projects, &session);
            let lines: Vec<String> = (0..40)
                .map(|m| {
                    reply(
                        "2026-11-10T12:00:00Z",
                        &format!("m{n}-{m}"),
                        "claude-opus-5",
                        1,
                        0,
                        0,
                        0,
                    )
                })
                .collect();
            append(&path, &lines);
            size += std::fs::metadata(&path).unwrap().len();
        }
        let tallies = DailyTallies::default();
        let totals: Vec<(u64, bool)> = std::thread::scope(|scope| {
            let workers: Vec<_> = (0..4)
                .map(|_| {
                    scope.spawn(|| {
                        let usage = run(&tallies, &projects);
                        (tokens_of(&usage.days[1], "claude-opus-5"), usage.complete)
                    })
                })
                .collect();
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .collect()
        });
        assert!(totals.iter().all(|total| *total == (24 * 40, true)));
        assert_eq!(bytes_read(&tallies), size);
    }
}
