// Prevents the Windows console window from appearing on release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    attymate_lib::run()
}
