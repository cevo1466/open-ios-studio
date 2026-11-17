//! Test the production simulator engine without GTK/WebKit or a desktop display.
#![allow(dead_code)]
#[path = "../../../src-tauri/src/fs_engine.rs"]
pub mod fs_engine;
#[path = "../../../src-tauri/src/runner.rs"]
pub mod runner;
#[path = "../../../src-tauri/src/simulator/mod.rs"]
pub mod simulator;
#[path = "../../../src-tauri/src/xtool.rs"]
pub mod xtool;

#[path = "../../../src-tauri/src/process_env.rs"]
pub mod process_env;
#[path = "../../../src-tauri/src/process_tree.rs"]
pub mod process_tree;
