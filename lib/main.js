function getConfig(param) {
  return atom.config.get(`clip-history.${param}`)
}

// Convert leading tab to space. support multiline string.
function tab2space(text, tabLength) {
  return text.replace(/^[\t ]+/gm, text => {
    return text.replace(/\t/g, " ".repeat(tabLength))
  })
}

// Convert leading space to tab. support multiline string.
function space2tab(text, tabLength) {
  return text.replace(/^ +/gm, function(s) {
    const tabs = "\t".repeat(Math.floor(s.length / tabLength))
    const spaces = " ".repeat(s.length % tabLength)
    return tabs + spaces
  })
}

// Return shortest leading space string in multiline string.
function getShortestLeadingSpace(text) {
  if (text.match(/^[^ ]/gm)) {
    return ""
  } else {
    return text.match(/^ +/gm).sort((a, b) => a.length - b.length)[0]
  }
}

function removeIndent(text) {
  const indent = getShortestLeadingSpace(text)
  return text.replace(new RegExp(`^${indent}`, "gm"), "")
}

function addIndent(text, indent) {
  return text.replace(/^/gm, (m, offset) => (offset === 0 ? m : indent))
}

function adjustIndent(text, {editor, indent}) {
  const tabLength = editor.getTabLength()
  text = tab2space(text, tabLength)
  text = removeIndent(text)
  text = addIndent(text, indent)
  return editor.getSoftTabs() ? text : space2tab(text, tabLength)
}

class PasteArea {
  constructor() {
    this.markerByCursor = new Map()
  }

  has(cursor) {
    return this.markerByCursor.has(cursor)
  }

  getRange(cursor) {
    if (this.has(cursor)) {
      return this.markerByCursor.get(cursor).getBufferRange()
    }
  }

  set(cursor, marker) {
    if (this.has(cursor)) {
      this.markerByCursor.get(cursor).destroy()
    }
    this.markerByCursor.set(cursor, marker)
  }

  clear() {
    this.markerByCursor.forEach(marker => marker.destroy())
    this.markerByCursor.clear()
  }

  isEmpty() {
    return this.markerByCursor.size === 0
  }

  destroy() {
    this.clear()
  }
}

class History {
  constructor() {
    this.lastPastedText = null
    this.pasting = false
    this.pasteArea = new PasteArea()
    this.clear()
  }

  clear() {
    this.entries = []
    this.resetIndex()
  }

  resetPasteState() {
    this.pasteArea.clear()
    this.resetIndex()
  }

  resetIndex() {
    this.index = -1
  }

  destroy() {
    this.pasteArea.destroy()
    if (this.cursorMoveObserver) this.cursorMoveObserver.dispose()
  }

  add(text, metadata) {
    // skip when empty or same text
    if (!text.length || text === this.entries[0]) {
      return
    }
    this.entries.unshift({text, metadata})

    // Unique by entry.text
    const entries = []
    const seen = {}
    for (let entry of this.entries) {
      if (entry.text in seen) continue
      entries.push(entry)
      seen[entry.text] = true
    }
    this.entries = entries
    this.entries.splice(getConfig("max"))
    this.resetIndex()
  }

  getEntry(which) {
    const index = this.index + (which === "newer" ? -1 : +1)
    this.index = this.getIndex(index)
    return this.entries[this.index]
  }

  // To make index rap within length
  getIndex(index) {
    const length = this.entries.length
    if (!length) return -1
    index = index % length
    return index >= 0 ? index : length + index
  }

  paste(editor, which) {
    if (editor.hasMultipleCursors() && getConfig("doNormalPasteWhenMultipleCursors")) {
      editor.pasteText()
      return
    }

    if (this.pasteArea.isEmpty()) {
      // This is 1st paste, system's clipboad might updated in outer world.
      this.add(atom.clipboard.read())
    }

    let textToPaste
    if (which === "lastPasted") {
      this.resetPasteState()
      textToPaste = this.lastPastedText
    } else {
      textToPaste = this.getEntry(which)
    }

    if (!textToPaste) return

    this.observeCursorMove(editor)
    this.pasting = true

    for (const cursor of editor.getCursors()) {
      this.insertText(cursor, textToPaste.text)
    }
    editor.scrollToCursorPosition({center: false})
    this.lastPastedText = textToPaste

    this.pasting = false
  }

  insertText(cursor, text) {
    const editor = cursor.editor
    const range = this.pasteArea.has(cursor) ? this.pasteArea.getRange(cursor) : cursor.selection.getBufferRange()
    if (getConfig("adjustIndent") && text.endsWith("\n")) {
      text = adjustIndent(text, {editor, indent: " ".repeat(range.start.column)})
    }

    const marker = editor.markBufferRange(editor.setTextInBufferRange(range, text))
    this.pasteArea.set(cursor, marker)

    if (getConfig("flashOnPaste")) {
      const markerForFlash = marker.copy()
      editor.decorateMarker(markerForFlash, {type: "highlight", class: "clip-history-pasted"})
      setTimeout(() => markerForFlash.destroy(), 1000)
    }
  }

  observeCursorMove(editor) {
    if (!this.cursorMoveObserver) {
      this.cursorMoveObserver = editor.onDidChangeCursorPosition(() => {
        if (this.pasting) return
        this.resetPasteState()
        this.cursorMoveObserver.dispose()
        this.cursorMoveObserver = null
      })
    }
  }
}

module.exports = {
  activate() {
    this.atomClipboardWrite = atom.clipboard.write
    atom.clipboard.write = (...args) => {
      this.getHistory().add(...args)
      return this.atomClipboardWrite.call(atom.clipboard, ...args)
    }

    const paste = (editor, which) => this.getHistory().paste(editor, which)

    // prettier-ignore
    this.disposable = atom.commands.add("atom-text-editor", {
      "clip-history:paste"() { paste(this.getModel(), "older") },
      "clip-history:paste-newer"() { paste(this.getModel(), "newer") },
      "clip-history:paste-last"() { paste(this.getModel(), "lastPasted") },
      "clip-history:clear": () => this.history && this.history.clear(),
    })
  },

  deactivate() {
    atom.clipboard.write = this.atomClipboardWrite
    if (this.history) this.history.destroy()
    this.disposable.dispose()
  },

  getHistory() {
    if (!this.history) {
      this.history = new History()
    }
    return this.history
  },
}
