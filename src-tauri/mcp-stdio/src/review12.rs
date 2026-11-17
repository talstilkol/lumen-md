//! Review 12: #1120 (review 11 M1, L2) was not fully reviewed. These tests hold its claims as
//! logic, from its own tables: an interpreter with no program argument reads stdin; each option
//! in `value_options` takes the next argument as its value (or names the program); every name in
//! SHELLS is refused, with a path and in any case; the page-writable roots are canonical and
//! include the app's backups folder. No input here is built to get past the allow-list: the
//! cases are the documented ones and the tables themselves.

use crate::allowlist::program_position;
use crate::{next_arg, page_writable_roots, reads_code_from_stdin, value_options, NextArg, Spec, SHELLS};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

const FAMILIES: [&str; 8] = ["python", "node", "deno", "bun", "perl", "ruby", "php", "lua"];

fn v(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

static N: AtomicUsize = AtomicUsize::new(0);

fn dir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("lumen-rev12-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(d).unwrap()
}

#[test]
fn every_option_in_the_value_table_takes_the_next_argument() {
    for family in FAMILIES {
        let (short, program, long) = value_options(family);
        for ch in short.chars() {
            let opt = format!("-{ch}");
            assert_eq!(next_arg(family, &opt), NextArg::Value, "{family} {opt}");
            // Its value is never the program: the script after it is.
            assert_eq!(program_position(family, &v(&[&opt, "VALUE", "s"])), 2, "{family} {opt}");
            // Attached, the value is part of the option.
            assert_eq!(next_arg(family, &format!("-{ch}VALUE")), NextArg::Free, "{family} -{ch}VALUE");
        }
        for ch in program.chars() {
            assert_eq!(next_arg(family, &format!("-{ch}")), NextArg::Program, "{family} -{ch}");
            assert_eq!(next_arg(family, &format!("-{ch}mod")), NextArg::ProgramHere, "{family} -{ch}mod");
            assert_eq!(program_position(family, &v(&[&format!("-{ch}"), "mod"])), 1, "{family} -{ch}");
        }
        for l in long {
            assert!(l.starts_with("--"), "{family} {l}");
            assert_eq!(next_arg(family, l), NextArg::Value, "{family} {l}");
            assert_eq!(next_arg(family, &format!("{l}=x")), NextArg::Free, "{family} {l}=x");
            assert_eq!(program_position(family, &v(&[l, "VALUE", "s"])), 2, "{family} {l}");
        }
        // An option outside the table is a flag.
        assert_eq!(next_arg(family, "--not-an-option"), NextArg::Free, "{family}");
    }
    // A family with no table: every option is a flag.
    assert_eq!(value_options("other"), ("", "", &[][..]));
    assert_eq!(next_arg("other", "-r"), NextArg::Free);
}

#[test]
fn an_interpreter_with_no_program_argument_reads_its_code_from_stdin() {
    for family in FAMILIES {
        assert!(reads_code_from_stdin(family, &[]), "{family}: no arguments");
        assert!(reads_code_from_stdin(family, &v(&["-"])), "{family}: -");
        assert!(!reads_code_from_stdin(family, &v(&["s"])), "{family}: a script");
        let (short, _, long) = value_options(family);
        for opt in short.chars().map(|c| format!("-{c}")).chain(long.iter().map(|l| l.to_string())) {
            // The option's value is not a program: with nothing after it, the program is stdin.
            assert!(reads_code_from_stdin(family, &v(&[&opt, "VALUE"])), "{family} {opt} VALUE");
            assert!(!reads_code_from_stdin(family, &v(&[&opt, "VALUE", "s"])), "{family} {opt} VALUE s");
        }
    }
    // osascript is judged elsewhere (its `-e`), never by this rule.
    assert!(!reads_code_from_stdin("osascript", &[]));
}

#[test]
fn every_listed_launcher_is_refused_by_name_with_a_path_and_in_any_case() {
    for added in ["nohup", "timeout", "nice", "ionice", "stdbuf", "setsid", "sudo", "doas", "xargs", "awk", "gawk", "mawk", "nawk"] {
        assert!(SHELLS.contains(&added), "review 11 L2 lists {added}");
    }
    for name in SHELLS {
        for cmd in [name.to_string(), format!("/usr/bin/{name}"), name.to_ascii_uppercase()] {
            let e = Spec { command: cmd.clone(), args: v(&["x"]), cwd: None }.validate().unwrap_err();
            assert!(e.contains("is a shell or launcher"), "{cmd}: {e}");
        }
    }
}

#[test]
fn page_writable_roots_are_canonical_and_include_the_backups_folder() {
    let d = dir();
    let vault = d.join("vault");
    let app = d.join("app");
    std::fs::create_dir_all(&vault).unwrap();
    std::fs::create_dir_all(app.join("backups")).unwrap();
    let s = |p: &PathBuf| p.to_string_lossy().into_owned();
    // A root given in a non-canonical form (with `..`) comes back canonical; an empty one is dropped.
    let odd = s(&d.join("app").join("..").join("vault"));
    assert_eq!(page_writable_roots(&[odd.clone(), String::new()], None), vec![s(&vault)]);
    assert_eq!(page_writable_roots(&[odd], Some(&app)), vec![s(&vault), s(&app.join("backups"))]);
    // The same root twice, in two spellings, is listed once.
    assert_eq!(page_writable_roots(&[s(&vault), s(&d.join(".").join("vault"))], None), vec![s(&vault)]);
    #[cfg(unix)]
    {
        let link = d.join("link");
        std::os::unix::fs::symlink(&vault, &link).unwrap();
        assert_eq!(page_writable_roots(&[s(&link)], None), vec![s(&vault)], "a symlinked root is its target");
    }
    let _ = std::fs::remove_dir_all(&d);
}
