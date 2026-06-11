import { readdir } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, '..', '..', '..', 'NEW SYS BOT', 'src', 'commands');

export async function getDocumentation() {
  const docs = [];
  const categories = ['setup', 'moderation', 'info', 'members', 'ticket', 'voice'];

  for (const cat of categories) {
    const dir = path.join(COMMANDS_DIR, cat);
    let files;
    try { files = await readdir(dir); } catch { continue; }

    for (const file of files.filter(f => f.endsWith('.js'))) {
      try {
        const mod = await import(pathToFileURL(path.join(dir, file)).href);
        if (mod.data) {
          docs.push({
            name: mod.data.name,
            description: mod.data.description,
            category: cat,
            options: mod.data.options || [],
          });
        }
      } catch {}
    }
  }

  return docs;
}
