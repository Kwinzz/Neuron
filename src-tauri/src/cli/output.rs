//! Terminal formatting helpers of the command line.

use crate::db::remote::AccessLevel;
use crate::util::now_ms;

/// Columns padded to their widest cell (two spaces between columns, last one not padded).
pub fn table(rows: &[Vec<String>]) -> String {
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let widths: Vec<usize> =
        (0..cols).map(|i| rows.iter().filter_map(|r| r.get(i)).map(|c| c.chars().count()).max().unwrap_or(0)).collect();
    let mut out = String::new();
    for row in rows {
        let mut line = String::new();
        for (i, cell) in row.iter().enumerate() {
            line.push_str(cell);
            if i + 1 < row.len() {
                let pad = widths[i].saturating_sub(cell.chars().count()) + 2;
                line.push_str(&" ".repeat(pad));
            }
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    out
}

pub fn on_off(value: bool) -> String {
    if value { crate::tr!("activé", "on") } else { crate::tr!("désactivé", "off") }
}

pub fn yes_no(value: bool) -> String {
    if value { crate::tr!("oui", "yes") } else { crate::tr!("non", "no") }
}

/// First characters of a node id (enough to tell devices apart).
pub fn short_id(id: &str) -> &str {
    id.get(..10).unwrap_or(id)
}

/// `123 456`.
pub fn spaced_code(code: &str) -> String {
    if code.len() == 6 { format!("{} {}", &code[..3], &code[3..]) } else { code.to_string() }
}

pub fn level(level: AccessLevel) -> String {
    match level {
        AccessLevel::Read => crate::tr!("lecture", "read"),
        AccessLevel::Chat => crate::tr!("discuter", "chat"),
        AccessLevel::Full => crate::tr!("complet", "full"),
    }
}

/// « il y a 5 min » / « 5 min ago ».
pub fn ago(at: Option<i64>) -> String {
    let Some(at) = at else { return crate::tr!("jamais", "never") };
    let secs = (now_ms() - at).max(0) / 1000;
    let span = if secs < 60 {
        format!("{secs} s")
    } else if secs < 3600 {
        format!("{} min", secs / 60)
    } else if secs < 86_400 {
        format!("{} h", secs / 3600)
    } else {
        crate::tr!("{} j", "{} d", secs / 86_400)
    };
    crate::tr!("il y a {span}", "{span} ago")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aligned_columns() {
        let rows = vec![
            vec!["a".to_string(), "long value".to_string(), "x".to_string()],
            vec!["é long".to_string(), "b".to_string(), String::new()],
        ];
        assert_eq!(table(&rows), "a       long value  x\né long  b\n");
        assert_eq!(spaced_code("012345"), "012 345");
        assert_eq!(short_id("0123456789abcdef"), "0123456789");
    }
}
