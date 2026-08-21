#!/usr/bin/env node
import { createProgram } from "./cli.js";

createProgram()
	.parseAsync(process.argv)
	.catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
