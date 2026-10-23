/*
  Author: Runor Ewhro
  description: boots the Suggestions worker implemented by workerHandler.
*/

/// <reference lib="webworker" />

// Safari evaluates a module worker's entry a second time when one of its
// chunks imports from it, and that copy's module state starts empty. the entry
// imports nothing, so the handler and its data stores live in ordinary chunks.
const handler = import('./workerHandler')

self.onmessage = async (event) => { await (await handler).handleMessage(event) }
