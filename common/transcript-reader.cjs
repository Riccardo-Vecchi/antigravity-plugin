'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const transcriptCache = new Map();
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

function getBrainDir(options = {}) {
  const env = options.env || process.env;
  if (options.brainDir) return options.brainDir;
  if (env.ANTIGRAVITY_BRAIN_DIR) return env.ANTIGRAVITY_BRAIN_DIR;
  if (env.GEMINI_HOME) return path.join(env.GEMINI_HOME, 'antigravity', 'brain');
  const home = options.home || os.homedir();
  return path.join(home, '.gemini', 'antigravity', 'brain');
}

function extractConversationId(key, options = {}) {
  if (!key || typeof key !== 'string') return '';
  if (key === 'default' || key === '/' || key === 'new') return '';
  const clean = key.split('?')[0].split('#')[0];
  const match = clean.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (match) return match[0];

  if (key.startsWith('conv:')) {
    const query = key.replace(/^conv:/, '').trim().toLowerCase();
    if (query.length >= 3) {
      try {
        const brainDir = getBrainDir(options);
        if (fs.existsSync(brainDir)) {
          const entries = fs.readdirSync(brainDir, { withFileTypes: true });
          for (const ent of entries) {
            if (!ent.isDirectory() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(ent.name)) continue;
            const logFile = path.join(brainDir, ent.name, '.system_generated', 'logs', 'transcript.jsonl');
            if (!fs.existsSync(logFile)) continue;
            let fd = null;
            try {
              fd = fs.openSync(logFile, 'r');
              const buf = Buffer.alloc(2048);
              const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
              const chunk = buf.toString('utf8', 0, bytesRead).toLowerCase();
              if (chunk.includes(query.slice(0, 40))) {
                return ent.name;
              }
            } finally {
              if (fd !== null) fs.closeSync(fd);
            }
          }
        }
      } catch {}
    }
  }
  return '';
}

function parseTranscriptContent(content) {
  if (!content || typeof content !== 'string') return null;
  const lines = content.trim().split('\n');
  let turns = 0;
  let totalChars = 0;
  let codeChars = 0;
  let imageTokens = 0;
  let imageCount = 0;
  let latestApiTokens = 0;
  let latestInputTokens = 0;
  let latestCacheReadTokens = 0;
  let latestOutputTokens = 0;
  let pendingCharsAfterApi = 0;
  let pendingCodeCharsAfterApi = 0;
  let pendingTurnsAfterApi = 0;
  const blocks = [];
  const images = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {

        turns++;
        pendingTurnsAfterApi++;
        const rawPrompt = (obj.content || '').replace(/<[^>]+>/g, ' ').trim();
        const promptSnippet = rawPrompt.slice(0, 80);
        const promptCode = (obj.content?.match(/```[\s\S]*?```/g) || []).reduce((acc, c) => acc + c.length, 0);
        const len = obj.content?.length || 0;
        const key = 'p:turn-' + turns + ':' + (promptSnippet || ('Turn ' + turns));
        blocks.push([key, { length: len, codeChars: promptCode }]);
        totalChars += len;
        codeChars += promptCode;
        pendingCharsAfterApi += len;
        pendingCodeCharsAfterApi += promptCode;

        if (Array.isArray(obj.media)) {
          for (const m of obj.media) {
            imageCount++;
            const imgKey = m.uri || ('img-' + imageCount);
            images.push([imgKey, 258]);
            imageTokens += 258;
          }
        }

      } else if (obj.type === 'PLANNER_RESPONSE') {
        if (typeof obj.input_tokens === 'number' || typeof obj.output_tokens === 'number' || typeof obj.cache_read_tokens === 'number') {
          const inTok = typeof obj.input_tokens === 'number' ? obj.input_tokens : 0;
          const cacheTok = typeof obj.cache_read_tokens === 'number' ? obj.cache_read_tokens : 0;
          const outTok = typeof obj.output_tokens === 'number' ? obj.output_tokens : 0;
          const t = inTok + cacheTok + outTok;
          if (t > 0) {
            latestApiTokens = t;
            latestInputTokens = inTok;
            latestCacheReadTokens = cacheTok;
            latestOutputTokens = outTok;
            pendingCharsAfterApi = 0;
            pendingCodeCharsAfterApi = 0;
            pendingTurnsAfterApi = 0;

          }
        }

        let stepChars = 0;
        let stepCode = 0;
        if (obj.content) {

          const respCode = (obj.content.match(/```[\s\S]*?```/g) || []).reduce((acc, c) => acc + c.length, 0);
          stepChars += obj.content.length;
          stepCode += respCode;
        }
        if (obj.thinking && typeof obj.thinking === 'string') {
          stepChars += obj.thinking.length;
          stepCode += obj.thinking.length;
        }
        if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
          const tcStr = JSON.stringify(obj.tool_calls);
          stepChars += tcStr.length;
          stepCode += tcStr.length;
        }
        if (stepChars > 0) {
          const key = 'r:step-' + (obj.step_index != null ? obj.step_index : blocks.length);
          blocks.push([key, { length: stepChars, codeChars: stepCode }]);
          totalChars += stepChars;
          codeChars += stepCode;
        }
      } else if (obj.type === 'GENERIC') {
        const len = obj.content?.length || 0;
        if (len > 0) {
          const code = (obj.content.match(/```[\s\S]*?```/g) || []).reduce((acc, c) => acc + c.length, 0) || len;
          const key = 'g:step-' + (obj.step_index != null ? obj.step_index : blocks.length);
          blocks.push([key, { length: len, codeChars: code }]);
          totalChars += len;
          codeChars += code;
          pendingCharsAfterApi += len;
          pendingCodeCharsAfterApi += code;
        }
      } else if (obj.type === 'SYSTEM_MESSAGE') {
        const len = obj.content?.length || 0;
        if (len > 0) {
          const code = (obj.content.match(/```[\s\S]*?```/g) || []).reduce((acc, c) => acc + c.length, 0);
          const key = 's:step-' + (obj.step_index != null ? obj.step_index : blocks.length);
          blocks.push([key, { length: len, codeChars: code }]);
          totalChars += len;
          codeChars += code;
          pendingCharsAfterApi += len;
          pendingCodeCharsAfterApi += code;
        }
      }
    } catch {}
  }

  return {
    turns,
    chars: totalChars,
    codeChars,
    imageTokens,
    imageCount,
    apiTokens: latestApiTokens,
    inputTokens: latestInputTokens,
    cacheReadTokens: latestCacheReadTokens,
    outputTokens: latestOutputTokens,
    pendingChars: pendingCharsAfterApi,
    pendingCodeChars: pendingCodeCharsAfterApi,
    pendingTurns: pendingTurnsAfterApi,
    blocks,
    images,
  };
}

function readTranscriptStats(conversationKey, options = {}) {
  const id = extractConversationId(conversationKey, options);
  if (!id) return null;
  const brainDir = getBrainDir(options);
  const logsDir = path.join(brainDir, id, '.system_generated', 'logs');
  const fullFile = path.join(logsDir, 'transcript_full.jsonl');
  const normalFile = path.join(logsDir, 'transcript.jsonl');

  try {
    let fileToRead = null;
    let fileStat = null;
    if (fs.existsSync(fullFile)) {
      fileToRead = fullFile;
      fileStat = fs.statSync(fullFile);
    } else if (fs.existsSync(normalFile)) {
      fileToRead = normalFile;
      fileStat = fs.statSync(normalFile);
    }
    if (!fileToRead || !fileStat.isFile() || fileStat.size > MAX_TRANSCRIPT_BYTES) return null;
    const stamp = `${fileStat.mtimeMs}:${fileStat.ctimeMs}:${fileStat.size}:${fileStat.ino}`;
    const cached = transcriptCache.get(fileToRead);
    if (cached?.stamp === stamp) return {...cached.stats, updatedAt: Date.now()};

    const content = fs.readFileSync(fileToRead, 'utf8');
    const parsed = parseTranscriptContent(content);
    if (!parsed) return null;

    const stats = {
      conversationId: id,
      maxChars: parsed.chars,
      maxCodeChars: parsed.codeChars,
      maxTurns: parsed.turns,
      maxImageTokens: parsed.imageTokens,
      maxDocTokens: 0,
      systemTokens: 1500,
      apiTokens: parsed.apiTokens,
      inputTokens: parsed.inputTokens,
      cacheReadTokens: parsed.cacheReadTokens,
      outputTokens: parsed.outputTokens,
      pendingChars: parsed.pendingChars,
      pendingCodeChars: parsed.pendingCodeChars,
      pendingTurns: parsed.pendingTurns,
      mtime: fileStat ? fileStat.mtimeMs : Date.now(),
      blocks: parsed.blocks,
      images: parsed.images,
      documents: [],
      updatedAt: Date.now()
    };
    transcriptCache.delete(fileToRead);
    transcriptCache.set(fileToRead, {stamp, stats});
    while (transcriptCache.size > 16) transcriptCache.delete(transcriptCache.keys().next().value);
    return {...stats};
  } catch {
    return null;
  }
}

module.exports = {
  getBrainDir,
  extractConversationId,
  parseTranscriptContent,
  readTranscriptStats
};
