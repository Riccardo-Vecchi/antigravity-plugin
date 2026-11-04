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
  const turnsList = [];
  let currentTurn = null;
  let prevTurnTotalTokens = 0;

  function finalizeTurn(turn, prevTotal) {
    if (!turn) return;
    turn.realDelta = prevTotal > 0 ? (turn.totalTokens - prevTotal) : turn.totalTokens;
    turn.deltaTokens = Math.max(0, turn.realDelta);
    if (turn.realDelta <= -30000) {
      turn.hasCompaction = true;
    }
    if (turn.hasCompaction && (!turn.preCompactionTokens || turn.preCompactionTokens === 0)) {
      if (turn.peakTokens && turn.peakTokens > turn.totalTokens) {
        turn.preCompactionTokens = turn.peakTokens;
      } else if (prevTotal > 0) {
        turn.preCompactionTokens = prevTotal;
      } else {
        turn.preCompactionTokens = turn.totalTokens;
      }
    }
    if (turn.hasCompaction && (!turn.postCompactionTokens || turn.postCompactionTokens === 0)) {
      turn.postCompactionTokens = turn.totalTokens;
    }
    const activeInput = (turn.inputTokens > 0 && turn.inputTokens < 20000)
      ? turn.inputTokens
      : Math.max((turn.promptEst || 0) + (turn.imageTokens || 0), 100);
    const activeOutput = turn.finalOutputTokens || turn.outputTokens || 0;
    turn.footprint = activeInput + activeOutput;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {
        if (currentTurn) {
          finalizeTurn(currentTurn, prevTurnTotalTokens);
          prevTurnTotalTokens = currentTurn.totalTokens;
          turnsList.push(currentTurn);
        }

        turns++;
        pendingTurnsAfterApi++;
        const rawPrompt = (obj.content || '').replace(/<[^>]+>/g, ' ').trim();
        const promptSnippet = rawPrompt.slice(0, 80);
        const promptKey = rawPrompt.replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
        const promptEst = Math.round(rawPrompt.length / 3.5);
        const promptCode = (obj.content?.match(/```[\s\S]*?```/g) || []).reduce((acc, c) => acc + c.length, 0);
        const len = obj.content?.length || 0;
        const key = 'p:turn-' + turns + ':' + (promptSnippet || ('Turn ' + turns));
        blocks.push([key, { length: len, codeChars: promptCode }]);
        totalChars += len;
        codeChars += promptCode;
        pendingCharsAfterApi += len;
        pendingCodeCharsAfterApi += promptCode;

        let turnImageTokens = 0;
        if (Array.isArray(obj.media)) {
          for (const m of obj.media) {
            imageCount++;
            const imgKey = m.uri || ('img-' + imageCount);
            images.push([imgKey, 258]);
            imageTokens += 258;
            turnImageTokens += 258;
          }
        }

        currentTurn = {
          turnIndex: turns,
          prompt: promptSnippet,
          promptKey,
          promptEst,
          responseKey: '',
          finalResponseKey: '',
          outputTokens: 0,
          finalOutputTokens: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          peakTokens: 0,
          deltaTokens: 0,
          realDelta: 0,
          footprint: 0,
          toolCallsCount: 0,
          hasCompaction: false,
          preCompactionTokens: 0,
          postCompactionTokens: 0,
          imageTokens: turnImageTokens
        };
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

            if (currentTurn) {
              if (t > currentTurn.peakTokens) {
                currentTurn.peakTokens = t;
              }
              currentTurn.totalTokens = t;
              currentTurn.inputTokens = inTok;
              currentTurn.cacheReadTokens = cacheTok;
              if (currentTurn.hasCompaction && !currentTurn.postCompactionTokens && currentTurn.preCompactionTokens > 0) {
                currentTurn.postCompactionTokens = t;
              }
            }
          }
        }
        if (currentTurn) {
          if (typeof obj.output_tokens === 'number') {
            currentTurn.outputTokens += obj.output_tokens;
            currentTurn.finalOutputTokens = obj.output_tokens;
          }
          if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
            currentTurn.toolCallsCount += obj.tool_calls.length;
          }
        }
        let stepChars = 0;
        let stepCode = 0;
        if (obj.content) {
          if (currentTurn && typeof obj.content === 'string') {
            const cleanResp = obj.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanResp.length > 10) {
              if (!currentTurn.responseKey) {
                currentTurn.responseKey = cleanResp.toLowerCase().slice(0, 50);
              }
              currentTurn.finalResponseKey = cleanResp.toLowerCase().slice(0, 50);
            }
          }
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
      } else if (obj.type === 'CHECKPOINT') {
        if (currentTurn) {
          currentTurn.hasCompaction = true;
          currentTurn.preCompactionTokens = currentTurn.peakTokens || currentTurn.totalTokens || prevTurnTotalTokens;
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

  if (currentTurn) {
    finalizeTurn(currentTurn, prevTurnTotalTokens);
    turnsList.push(currentTurn);
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
    turnsList
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
      turnsList: parsed.turnsList || [],
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
