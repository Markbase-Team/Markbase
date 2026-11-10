-- Suggestions as anchored replacements: "change this quoted text to that". On
-- accept we re-resolve the quote against the current doc and apply it as a
-- normal edit (reusing anchoredEditToSteps), so history stays honest.
alter table docs.suggestions alter column steps drop not null;
alter table docs.suggestions
  add column if not exists quoted_text text not null default '',
  add column if not exists replacement text not null default '',
  add column if not exists note text not null default '';
