//go:build !(js && wasm)

// The wasm entry point builds for the browser only. This file keeps
// `go build ./...` working on every other target, where the package has
// nothing to compile.
package main

func main() {}
