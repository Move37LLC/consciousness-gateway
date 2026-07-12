/**
 * Export conversation_history → TRANSCRIPTS_DIR as searchable .txt files.
 *
 * Usage (Mac Mini):
 *   TRANSCRIPTS_DIR=~/consciousness-gateway/transcripts npm run export:transcripts
 */

import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { ConversationStore } from '../memory/conversation-store';
import {
  exportConversationsToTranscripts,
  resolveTranscriptsDir,
} from '../tools/transcript-export';

const outDir = resolveTranscriptsDir(process.env.TRANSCRIPTS_DIR);
if (outDir === '/mnt/transcripts' && !process.env.TRANSCRIPTS_DIR) {
  console.error(
    'TRANSCRIPTS_DIR is not set. On macOS set it first, e.g.:\n' +
    '  export TRANSCRIPTS_DIR="$HOME/consciousness-gateway/transcripts"\n' +
    '  echo "TRANSCRIPTS_DIR=$TRANSCRIPTS_DIR" >> .env',
  );
  process.exit(2);
}

const dbPath = path.join(process.cwd(), 'data', 'consciousness.db');
const store = new ConversationStore(dbPath);
const result = exportConversationsToTranscripts(store, { outDir });

console.log('  ===== Transcript export =====');
console.log(`  outDir:            ${result.outDir}`);
console.log(`  files written:     ${result.filesWritten}`);
console.log(`  sessions exported: ${result.sessionsExported}`);
console.log(`  sessions skipped:  ${result.sessionsSkipped} (excluded: ${result.excludedChannels.join(', ')})`);
console.log(`  messages exported: ${result.messagesExported}`);
console.log('  =============================');

store.close();
