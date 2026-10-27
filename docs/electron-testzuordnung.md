# Spoken-Upload – Zuordnung der Python-Tests zu den TS-Tests (Phase 4)

> **Stand nach der Ablösung:** Die Python-Tests sind mit der Python-Fassung entfernt (zuletzt
> enthalten in Commit `e14d775`). Die Tabelle unten ist jetzt die Grundlage:
> `app/tests/unit/testzuordnung.test.ts` liest die 57 Einträge daraus und prüft, dass jeder einen
> gleichnamigen TS-Test hat.

Jeder der **57** Python-Tests aus `tests/*.py` hat mindestens einen TS-Test, dessen
`it(...)`-/`test(...)`-Name den Python-Methodennamen enthält (Architektur §8.1). **Es fehlen 0.**

- Erzeugt per Skript: Python-Tests per Regex aus `tests/test_*.py` (`class …` / `def test_…(self`),
  gegengeprüft mit `python3 -I -m unittest discover -s tests` (57 Tests); gesucht in allen
  `app/tests/**/*.test.ts` (vitest) und `app/tests/**/*.spec.ts` (Playwright).
- Automatisch geprüft von `app/tests/unit/testzuordnung.test.ts` (Teil von `npm test`): Der Test
  liest die Python-Tests, sucht die Namen in `app/tests` und prüft, dass diese Tabelle jeden nennt.
- Einige Python-Tests haben mehrere TS-Gegenstücke (über den Kern, direkt am Modul, im Fenster).
- Pfade der TS-Dateien relativ zu `app/`.

| Nr. | Python (Datei::Klasse::Methode) | TS-Datei – Testname |
|---|---|---|
| 1 | `test_gui.py::Window::test_late_answer_for_an_old_theme_setting_is_ignored` | `tests/unit/main/themeLogic.test.ts` – „test_late_answer_for_an_old_theme_setting_is_ignored“ |
| 2 | `test_gui.py::Window::test_dropdown_list_follows_the_theme` | `tests/ui/history-window.spec.ts` – „test_dropdown_list_follows_the_theme“ |
| 3 | `test_gui.py::Window::test_search_finds_text_in_the_sent_data` | `tests/ui/history-window.spec.ts` – „test_search_finds_text_in_the_sent_data“<br>`tests/unit/history/views.test.ts` – „test_search_finds_text_in_the_sent_data (Datenlogik)“<br>`tests/unit/renderer/highlight.test.ts` – „test_search_finds_text_in_the_sent_data: höchstens 1000 Treffer“ |
| 4 | `test_history_settings_system.py::History::test_entries_newest_first_with_search_and_statistics` | `tests/unit/history/archive.test.ts` – „test_entries_newest_first_with_search_and_statistics (direkt)“<br>`tests/unit/history/history.test.ts` – „test_entries_newest_first_with_search_and_statistics“ |
| 5 | `test_history_settings_system.py::History::test_entry_without_time_zone_or_broken_is_still_sortable` | `tests/unit/history/archive.test.ts` – „test_entry_without_time_zone_or_broken_is_still_sortable (direkt)“<br>`tests/unit/history/history.test.ts` – „test_entry_without_time_zone_or_broken_is_still_sortable“ |
| 6 | `test_history_settings_system.py::History::test_old_archive_is_migrated` | `tests/unit/history/archive.test.ts` – „test_old_archive_is_migrated (direkt)“<br>`tests/unit/history/history.test.ts` – „test_old_archive_is_migrated“ |
| 7 | `test_history_settings_system.py::History::test_old_archive_with_impossible_time_stays_put` | `tests/unit/history/archive.test.ts` – „test_old_archive_with_impossible_time_stays_put (direkt)“<br>`tests/unit/history/history.test.ts` – „test_old_archive_with_impossible_time_stays_put“ |
| 8 | `test_history_settings_system.py::Login::test_without_keyring_the_password_is_in_a_private_file` | `tests/unit/settings/login.test.ts` – „test_without_keyring_the_password_is_in_a_private_file“ |
| 9 | `test_history_settings_system.py::Login::test_with_keyring_the_file_has_no_password` | `tests/unit/settings/login.test.ts` – „test_with_keyring_the_file_has_no_password“ |
| 10 | `test_history_settings_system.py::Login::test_old_password_moves_into_keyring` | `tests/unit/settings/login.test.ts` – „test_old_password_moves_into_keyring“ |
| 11 | `test_history_settings_system.py::Login::test_password_stays_in_file_while_keyring_is_locked` | `tests/unit/settings/login.test.ts` – „test_password_stays_in_file_while_keyring_is_locked“ |
| 12 | `test_history_settings_system.py::Login::test_password_stays_in_file_when_keyring_loses_it` | `tests/unit/settings/login.test.ts` – „test_password_stays_in_file_when_keyring_loses_it“ |
| 13 | `test_history_settings_system.py::Login::test_password_survives_when_login_file_cannot_be_rewritten` | `tests/unit/settings/login.test.ts` – „test_password_survives_when_login_file_cannot_be_rewritten“ |
| 14 | `test_history_settings_system.py::Login::test_logout_with_locked_keyring_reports_the_leftover` | `tests/unit/settings/login.test.ts` – „test_logout_with_locked_keyring_reports_the_leftover“ |
| 15 | `test_history_settings_system.py::Login::test_logout_without_keyring_entry_is_clean` | `tests/unit/settings/login.test.ts` – „test_logout_without_keyring_entry_is_clean“ |
| 16 | `test_history_settings_system.py::Login::test_new_account_replaces_the_old_keyring_entry` | `tests/unit/settings/login.test.ts` – „test_new_account_replaces_the_old_keyring_entry“ |
| 17 | `test_history_settings_system.py::Login::test_locked_keyring_gives_no_password` | `tests/unit/settings/login.test.ts` – „test_locked_keyring_gives_no_password“ |
| 18 | `test_history_settings_system.py::CommandLine::test_test_run_changes_nothing` | `tests/unit/main/cli.test.ts` – „test_test_run_changes_nothing“ |
| 19 | `test_history_settings_system.py::CommandLine::test_unknown_argument` | `tests/unit/main/cli.test.ts` – „test_unknown_argument“ |
| 20 | `test_history_settings_system.py::RunningGame::test_paths_of_all_systems` | `tests/unit/platform/running.test.ts` – „test_paths_of_all_systems“ |
| 21 | `test_history_settings_system.py::WowFolder::test_wow_root_from_inside_and_above` | `tests/unit/platform/wowfind.test.ts` – „test_wow_root_from_inside_and_above“<br>`tests/unit/platform/wowfind.test.ts` – „test_wow_root_from_inside_and_above (direkt, ohne createCore)“ |
| 22 | `test_upload.py::Contributions::test_success_sends_archives_and_clears` | `tests/unit/upload/contributions.test.ts` – „test_success_sends_archives_and_clears“ |
| 23 | `test_upload.py::Contributions::test_server_error_keeps_everything` | `tests/unit/upload/contributions.test.ts` – „test_server_error_keeps_everything“ |
| 24 | `test_upload.py::Contributions::test_more_than_2000_lines_go_in_several_uploads` | `tests/unit/upload/contributions.test.ts` – „test_more_than_2000_lines_go_in_several_uploads“ |
| 25 | `test_upload.py::Contributions::test_failure_in_second_upload_clears_nothing` | `tests/unit/upload/contributions.test.ts` – „test_failure_in_second_upload_clears_nothing“ |
| 26 | `test_upload.py::Contributions::test_lines_added_during_upload_are_kept` | `tests/unit/upload/contributions.test.ts` – „test_lines_added_during_upload_are_kept“ |
| 27 | `test_upload.py::Contributions::test_file_needing_more_uploads_than_an_hour_allows_stays_untouched` | `tests/unit/upload/contributions.test.ts` – „test_file_needing_more_uploads_than_an_hour_allows_stays_untouched“ |
| 28 | `test_upload.py::Contributions::test_archive_failure_clears_nothing` | `tests/unit/upload/contributions.test.ts` – „test_archive_failure_clears_nothing“ |
| 29 | `test_upload.py::Contributions::test_dry_run_changes_nothing` | `tests/unit/upload/contributions.test.ts` – „test_dry_run_changes_nothing“ |
| 30 | `test_upload.py::RateLimit::test_uploads_are_counted` | `tests/unit/upload/ratelimit.test.ts` – „test_uploads_are_counted“ |
| 31 | `test_upload.py::RateLimit::test_full_hour_blocks_without_asking_the_server` | `tests/unit/upload/ratelimit.test.ts` – „test_full_hour_blocks_without_asking_the_server“ |
| 32 | `test_upload.py::RateLimit::test_429_marks_the_hour_as_full` | `tests/unit/upload/ratelimit.test.ts` – „test_429_marks_the_hour_as_full“ |
| 33 | `test_upload.py::RateLimit::test_old_uploads_expire` | `tests/unit/upload/ratelimit.test.ts` – „test_old_uploads_expire“ |
| 34 | `test_upload.py::UploadTimes::test_broken_entries_are_skipped` | `tests/unit/upload/uploadtimes.test.ts` – „test_broken_entries_are_skipped“ |
| 35 | `test_upload.py::UploadTimes::test_times_in_the_future_do_not_block` | `tests/unit/upload/uploadtimes.test.ts` – „test_times_in_the_future_do_not_block“ |
| 36 | `test_upload.py::UploadTimes::test_free_at_counts_from_the_oldest_uploads` | `tests/unit/upload/uploadtimes.test.ts` – „test_free_at_counts_from_the_oldest_uploads“ |
| 37 | `test_upload.py::UploadTimes::test_free_at_with_more_than_an_hour_of_uploads` | `tests/unit/upload/uploadtimes.test.ts` – „test_free_at_with_more_than_an_hour_of_uploads“ |
| 38 | `test_upload.py::UploadTimes::test_free_at_is_in_local_time` | `tests/unit/upload/uploadtimes.test.ts` – „test_free_at_is_in_local_time“ |
| 39 | `test_upload.py::NpcTexts::test_success_archives_and_deletes_cache` | `tests/unit/upload/npctexts.test.ts` – „test_success_archives_and_deletes_cache“ |
| 40 | `test_upload.py::NpcTexts::test_failure_in_one_version_keeps_its_cache` | `tests/unit/upload/npctexts.test.ts` – „test_failure_in_one_version_keeps_its_cache“ |
| 41 | `test_upload.py::NpcTexts::test_not_logged_in_keeps_cache` | `tests/unit/upload/npctexts.test.ts` – „test_not_logged_in_keeps_cache“ |
| 42 | `test_upload.py::NpcTexts::test_password_missing_from_keyring_keeps_cache` | `tests/unit/upload/npctexts.test.ts` – „test_password_missing_from_keyring_keeps_cache“ |
| 43 | `test_upload.py::NpcTexts::test_rejected_login` | `tests/unit/upload/npctexts.test.ts` – „test_rejected_login“ |
| 44 | `test_upload.py::RunningGame::test_running_version_is_skipped` | `tests/unit/upload/running.test.ts` – „test_running_version_is_skipped“ |
| 45 | `test_upload.py::RunningGame::test_unknown_running_version_stops` | `tests/unit/upload/running.test.ts` – „test_unknown_running_version_stops“ |
| 46 | `test_upload.py::RunningGame::test_overview_leaves_out_running_versions` | `tests/unit/upload/running.test.ts` – „test_overview_leaves_out_running_versions“ |
| 47 | `test_wowdata.py::DecodeLua::test_escapes` | `tests/unit/wowdata/decodeLua.test.ts` – „test_escapes“ |
| 48 | `test_wowdata.py::DecodeLua::test_utf8_bytes_as_decimal_escapes` | `tests/unit/wowdata/decodeLua.test.ts` – „test_utf8_bytes_as_decimal_escapes“ |
| 49 | `test_wowdata.py::Contributions::test_envelopes_survive_the_lua_file_bit_exact` | `tests/unit/wowdata/contributions.test.ts` – „test_envelopes_survive_the_lua_file_bit_exact“ |
| 50 | `test_wowdata.py::Contributions::test_lua_and_bak_are_merged_without_duplicates` | `tests/unit/wowdata/contributions.test.ts` – „test_lua_and_bak_are_merged_without_duplicates“ |
| 51 | `test_wowdata.py::Contributions::test_bak_without_lua_counts` | `tests/unit/wowdata/contributions.test.ts` – „test_bak_without_lua_counts“ |
| 52 | `test_wowdata.py::Contributions::test_clearing_keeps_flags_with_crlf` | `tests/unit/wowdata/contributions.test.ts` – „test_clearing_keeps_flags_with_crlf“ |
| 53 | `test_wowdata.py::Contributions::test_file_with_unsent_lines_is_not_cleared` | `tests/unit/wowdata/contributions.test.ts` – „test_file_with_unsent_lines_is_not_cleared“ |
| 54 | `test_wowdata.py::Contributions::test_parse_envelope_and_summary` | `tests/unit/wowdata/contributions.test.ts` – „test_parse_envelope_and_summary“ |
| 55 | `test_wowdata.py::Cache::test_reads_only_live_broadcast_texts` | `tests/unit/wowdata/cache.test.ts` – „test_reads_only_live_broadcast_texts“ |
| 56 | `test_wowdata.py::Cache::test_broken_files_do_not_crash` | `tests/unit/wowdata/cache.test.ts` – „test_broken_files_do_not_crash“ |
| 57 | `test_wowdata.py::Cache::test_newest_build_wins` | `tests/unit/wowdata/cache.test.ts` – „test_newest_build_wins“ |
