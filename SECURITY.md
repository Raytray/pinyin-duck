# Security policy

An input method sees everything its user types, including passwords and private
messages. Security reports are taken seriously.

## Reporting a vulnerability

Report privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Please do not open a public issue, pull request or
discussion for a security problem.

Include what you found, the affected platform and version, steps to reproduce, and the
impact as you understand it. You should get a first reply within a week. Once a fix is
released, the advisory will be published and you will be credited unless you prefer not
to be.

## Supported versions

PinyinDuck is pre-1.0. Only the latest code on `main` receives security fixes.

## What PinyinDuck does with your input

These are the design properties a report would most likely be about. A change that breaks
one of them is a security issue:

- **Android**: the keyboard requests no Android permissions, including no network access.
  Dictionary lookups happen on the device.
- **Windows and macOS**: the Rime schemas set `enable_user_dict: false`, so typed words
  are not recorded in a Rime user dictionary.
- **Web**: the playground downloads the dictionary once, then searches in the browser. It
  does not send what you type anywhere.

## In scope

- Anything that lets typed text leave the device or be stored.
- Code execution through a crafted dictionary file, schema or installer input.
- Problems in the Windows and macOS installers, such as writing outside their intended
  directories or running with more privilege than needed.
- Supply-chain issues in this repository's build and CI.

Vulnerabilities in upstream projects (librime, Weasel, Squirrel, CC-CEDICT) should go to
those projects. Let us know too if PinyinDuck needs to respond.
