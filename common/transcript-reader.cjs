'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getBrainDir(options = {}) {
  const env = options.env || process.env;
  if (options.brainDir) return options.brainDir;
  if (env.ANTIGRAVITY_BRAIN_DIR) return env.ANTIGRAVITY_BRAIN_DIR;
  if (env.GEMINI_HOME) return path.join(env.GEMINI_HOME, 'antigravity', 'brain');
  const home = options.home || os.homedir();
  return path.join(home, '.gemini', 'antigravity', 'brain');
}

function extractConversationId(key) {
  if (!key || typeof key !== 'string') return '';
  const clean = key.split('?')[0].split('#')[0];
  const match = clean.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : '';
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
  const blocks = [];
  const images = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {
        turns++;
        const prompt = (obj.content || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 80);
        const promptCode = (obj.content?.match(/```[\s\S]*?```/g) || []).reduce((acc, c) => acc + c.length, 0);
        const len = obj.content?.length || 0;
        const key = 'p:' + (prompt || ('Turn ' + turns));
        blocks.push([key, { length: len, codeChars: promptCode }]);
        totalChars += len;
        codeChars += promptCode;

        if (Array.isArray(obj.media)) {
          for (const m of obj.media) {
            imageCount++;
            const imgKey = m.uri || ('img-' + imageCount);
            images.push([imgKey, 258]);
            imageTokens += 258;
          }
        }
      } else if (obj.type === 'PLANNER_RESPONSE') {
        if (typeof obj.input_tokens === 'number') {
          const t = (obj.input_tokens || 0) + (obj.cache_read_tokens || 0);
          if (t > 0) latestApiTokens = t;
        }
        if (obj.content) {
          const respCode = (obj.content.match(/```[\s\S]*?```/g) || []).reduce((acc, c) => acc + c.length, 0);
          const key = 'r:step-' + (obj.step_index != null ? obj.step_index : blocks.length);
          blocks.push([key, { length: obj.content.length, codeChars: respCode }]);
          totalChars += obj.content.length;
          codeChars += respCode;
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
    blocks,
    images
  };
}

function readTranscriptStats(conversationKey, options = {}) {
  const id = extractConversationId(conversationKey);
  if (!id) return null;
  const brainDir = getBrainDir(options);
  const file = path.join(brainDir, id, '.system_generated', 'logs', 'transcript.jsonl');
  try {
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, 'utf8');
    const parsed = parseTranscriptContent(content);
    if (!parsed) return null;

    return {
      conversationId: id,
      maxChars: parsed.chars,
      maxCodeChars: parsed.codeChars,
      maxTurns: parsed.turns,
      maxImageTokens: parsed.imageTokens,
      maxDocTokens: 0,
      systemTokens: 1500,
      apiTokens: parsed.apiTokens,
      blocks: parsed.blocks,
      images: parsed.images,
      documents: [],
      updatedAt: Date.now()
    };
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
