/**
 * Migration: 1727300004000_timer_sessions_optional_task.cjs
 *
 * Focus sessions can now be started without a task. The composite foreign key to tasks still
 * applies when task_id is set, because PostgreSQL skips a foreign key check when a column is NULL.
 */

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE timer_sessions ALTER COLUMN task_id DROP NOT NULL;');
};

exports.down = (pgm) => {
  // The previous schema cannot store sessions without a task, so those rows are removed first.
  pgm.sql('DELETE FROM timer_sessions WHERE task_id IS NULL;');
  pgm.sql('ALTER TABLE timer_sessions ALTER COLUMN task_id SET NOT NULL;');
};
