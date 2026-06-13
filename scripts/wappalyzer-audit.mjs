#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { parse } from "node-html-parser";

const require = createRequire(import.meta.url);
