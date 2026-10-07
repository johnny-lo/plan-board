**English** · [繁體中文](README.zh-TW.md)

# plan-board

**A plan board for Claude Code: see what is done, what is in progress and what is next, and decide without leaving the session.**

plan-board is a Claude Code plugin. A repo that has `plan/log.jsonl` keeps its plan there; any other repo keeps it on your machine until you run `/plan init`. A pane shows the plan as an overview and as decision cards, and a line above the prompt tells you how many items are in progress and how many decisions are waiting for you. Only the AI changes the plan, through the plugin's tools, and every change is logged with a reason.

## Install

In Claude Code:

```
/plugin marketplace add johnny-lo/plan-board
/plugin install plan-board@plan-board
```

Open the pane with `/plan`, or press **Open** on the line above the prompt.

## Language

The plugin has one option, `language`: `en` (the default) or `zh-TW`. Claude Code asks for it when you install the plugin, and you can change it later in the plugin's settings. It sets the fixed text of the pane and of the line above the prompt. Item names, reasons and questions are written by the AI in your words and are not translated. The instructions and messages that go to the AI are always English.

## Where the plan lives

There are two modes, decided each time the plan is read: **repo mode** when `plan/log.jsonl` exists, **local mode** when it does not. The tools, the pane and the line above the prompt work the same in both.

- In repo mode the plan is `plan/log.jsonl` in the repo's root (the worktree's `git rev-parse --show-toplevel`; the session's directory when it is not a git repo). It is a log: one JSON line per change, only ever appended to. The overview, the cards and every state are computed from the log; no current state is stored anywhere.
- In repo mode the first write also adds this line to `.gitattributes`:

  ```
  plan/log.jsonl merge=union
  ```

  It makes git join the lines two branches or two machines appended, so a merge or a rebase of the plan never conflicts. Commit both files with the rest of your work. The plugin never commits or pushes.
- The plan follows the code: each branch has its own copy, and a feature branch's progress shows on `main` after the merge.
- In local mode the plan is the same log text, kept in the plugin's store on this machine under the repo's root. It does not follow git, `.gitattributes` is left alone, and no file in the repo is created or changed. The overview shows one small line saying so.
- Only you move a repo to repo mode, by typing `/plan init` in it. It creates `plan/log.jsonl` with the local log unchanged, clears the local copy and makes sure `.gitattributes` has the line above. Neither the plugin's tools nor the AI ever create `plan/`; when a repo looks like a good place for one, the AI asks you with a decision card whether to run `/plan init`. When `plan/log.jsonl` already exists, `/plan init` changes nothing and says so.
- The plan is changed only through the plugin's tools. `Edit` and `Write` on files under `plan/` are refused. Each line carries a checksum, so a line changed any other way (a shell, another tool, your editor) is marked as edited directly: the pane and the line above the prompt warn you, and the AI is asked to look at `git diff -- plan/log.jsonl` and either keep or drop it, asking you first when it touches items.
- The pane's stage-and-send state (picks not yet sent, cards sent and waiting to be closed, what is expanded) belongs to your machine and is not in the repo.

## Items and steps

| What changes | How | Needs your approval |
|---|---|---|
| Items: add, remove, split, merge, change the sentence or the goal, reorder | The AI opens a proposal card with `propose_change`, you choose **Approve**, the AI applies it with `apply_change` | Yes |
| An item's state | Nobody sets it; it is computed from its steps (done, in progress, next, later) | n/a |
| Steps: add, reword, remove, move to another item, assign, change status | The AI uses `update_step` | No, but every change is logged with a reason |

- An **item** is your level: one sentence and one line for what done looks like. Items are ordered.
- A **step** is the AI's level: one sentence, a status (not started, in progress, done) and optionally who it is assigned to. A step is **stuck** while an open card points at it.
- A step is marked done only with evidence: a Thoth task id once the AI's Thoth tools show the task passed, or a one-line result the AI reports.
- **Decision cards** are questions the AI asks with `add_decision` (2 to 4 options, each with what it leads to, at most one recommended) and the proposals above. A card names the item and step it is about, says why it is asked now and shows the item's last three changes. Choices that block the AI's work are sent at once; the others are staged, sent with one button, sent by themselves after a minute without activity, and held until the AI's turn ends when it is working. A sent card is dimmed until the AI closes it.
- A card you answered only with a thought stays open: its options and the thought box remain, with your thought shown, and it still counts as waiting for you. A card you answered with a choice, or skipped, is dimmed.
- The pane never shows ids. A step assigned to a Thoth task shows as "assigned to a Thoth task" instead of the task id.

## Superpowers

plan-board and [superpowers](https://github.com/obra/superpowers) split the work: superpowers says how a piece of work is done, plan-board says how far it is and why it changed. An item can link the specs and plans written for it (paths from the repo root); the AI does it with `update_step` and the action `link`, which needs no approval and is logged with a reason. The expanded overview lists each linked path under the item's goal. Once a plan is written, the AI adds each of its tasks as a step of the item, and marks the step done when the task is done. plan-board only stores the paths; it never reads superpowers files.

## Thoth

plan-board and [Thoth](https://github.com/johnny-lo/Thoth) work well together but are independent. plan-board does not read Thoth or any other outside state. When a Thoth task passes, the AI sees it with its own Thoth tools and records it in the plan with plan-board's tools.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
