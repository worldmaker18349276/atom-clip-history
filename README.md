# paste-cycle

Fork of [clip-history](https://github.com/t9md/atom-clip-history).

Paste from clipboard history like emacs' kill-ring

# How to use

1. Paste clipboard entry by `paste-cycle:paste`
2. Continue `paste-cycle:paste` until you get entry you want.
3. when you get passed the text you wanted to paste, use `paste-cycle:paste-newer`.
4. you can paste last pasted text with `paste-cycle:paste-last`.

# Commands

* `paste-cycle:paste`: Paste. Continuous execution without moving cursor pops older entry.
* `paste-cycle:paste-newer`: Paste. Continuous execution without moving cursor pops newer entry.
* `paste-cycle:paste-last`: Paste last pasted text.
* `paste-cycle:clear`: Clear clipboard history.

# Keymap

No keymap by default.

e.g.

```coffeescript
'atom-text-editor:not([mini])':
  'ctrl-y': 'paste-cycle:paste'
  'cmd-y': 'paste-cycle:paste-newer'
  'ctrl-Y': 'paste-cycle:paste-last'
```

# Modify flash duration

From v0.3.0, `flashDurationMilliSeconds` config was removed to use better flashing animation by CSS keyframe. Default
duration is one second, if you want this shorter, modify your `style.less`.

```less
atom-text-editor.editor .paste-cycle-pasted .region {
  // default is 1s, you can tweak in the range from 0 to 1s(maximum).
  animation-duration: 0.5s;
}
```

# Features

* Paste old clipboard entry.
* Auto indent on past (configured by native setting).
* Flash/select pasted area.
* Support multiple cursor (disabled by default).
* Easy undo the entire paste cycle.
