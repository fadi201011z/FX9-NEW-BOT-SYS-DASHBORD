/* Generates src/data/commandUsage.json from the bot's own command definitions.
 *
 * The bot declares every command with a SlashCommandBuilder, so the arguments,
 * their types, which are required, their ranges and the Discord permission each
 * command demands are all already written down in the bot's source. There is
 * nothing here to invent — this script only reads them out so the dashboard's
 * examples can say what the command actually takes, including subcommands,
 * which a naive regex flattens into nonsense (/role <user> <role> <user> <role>).
 *
 *   node scripts/gen-command-usage.mjs ../FX9-BOT-SYS-main/src/commands
 *
 * The path defaults to the sibling checkout. On a deploy the bot folder is not
 * present and this script is not run at all; the committed JSON is what the page
 * reads. Re-run it whenever the bot adds or changes a command.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'src', 'data', 'commandUsage.json');

const BOT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', 'FX9-BOT-SYS-main', 'src', 'commands');

/* Discord permission flags, as the bot spells them, to the Arabic the page
   shows. Anything unmapped falls through as the flag name itself. */
const PERMISSION_AR = {
  ManageGuild: 'إدارة السيرفر',
  Administrator: 'مدير السيرفر',
  BanMembers: 'حظر الأعضاء',
  KickMembers: 'طرد الأعضاء',
  ManageMessages: 'إدارة الرسائل',
  ManageChannels: 'إدارة القنوات',
  ManageRoles: 'إدارة الرتب',
  ManageNicknames: 'إدارة الألقاب',
  ModerateMembers: 'إيقاف الأعضاء',
};

/* Discord slash option types, as addXOption names them, to Arabic. */
const TYPE_AR = {
  User: 'عضو',
  Channel: 'قناة',
  Role: 'رتبة',
  String: 'نص',
  Integer: 'رقم',
  Number: 'عدد',
  Boolean: 'اختيار',
  Mentionable: 'ذكر',
  Attachment: 'ملف',
};

/* Sample values for the example invocations. Keyed by name *and* type because
   two commands both call an option `duration` and mean different things by it:
   /timeout takes "10m", /maintenance takes a number of minutes. Only the
   option's own declared name, type, choices or bounds feed this — nothing here
   can contradict the bot. */
const SAMPLE = {
  'delete_days:Integer': '7',
  'amount:Integer': '50',
  'seconds:Integer': '60',
  'duration:Integer': '30',
  'duration:String': '10m',
  total: '#قناة الإجمالي',
  online: '#قناة المتصلين',
  bots: '#قناة البوتات',
};

const ARG_ADD = /\.add(\w+)Option\(\s*opt\s*=>/g;

/* Reads one `opt => …` chain. `kind` is the addXOption word that introduced
   it — User, Channel, String — which is how the option's type is known. */
function readOption(kind, body) {
  const name = body.match(/\.setName\(\s*['"`](.+?)['"`]/);
  if (!name) return null;
  const o = {
    name: name[1],
    type: kind,
    required: /\.setRequired\(\s*true\s*\)/.test(body),
    desc: (body.match(/\.setDescription\(\s*['"`](.+?)['"`]/) || [, ''])[1],
  };
  const mn = body.match(/\.setMinValue\(\s*(-?[\d.]+)\s*\)/);
  const mx = body.match(/\.setMaxValue\(\s*(-?[\d.]+)\s*\)/);
  if (mn) o.min = Number(mn[1]);
  if (mx) o.max = Number(mx[1]);
  const ch = body.match(/\.addChoices\(([\s\S]*?)\)\s*(?=\.set|\.add|$)/);
  if (ch) {
    // Two spellings in this codebase: setName('x') and { name: '…', value: 'x' }.
    // `value` is what a user actually types, so it wins where both are present.
    const values = [...ch[1].matchAll(/value:\s*['"`](.+?)['"`]/g)].map(x => x[1]);
    const named = [...ch[1].matchAll(/setName\(\s*['"`](.+?)['"`]/g)].map(x => x[1]);
    o.choices = values.length ? values : named;
  }
  // A channel narrowed with addChannelTypes is not a generic channel, and an
  // example that says "#قناة" where the command demands a voice channel is
  // wrong. The three the bot uses are named explicitly below.
  const ct = body.match(/\.addChannelTypes\(([^)]*)\)/);
  if (ct) o.channelTypes = [...ct[1].matchAll(/ChannelType\.(\w+)/g)].map(x => x[1]);
  return o;
}

const CHANNEL_SAMPLE = {
  GuildVoice: '#قناة صوتية',
  GuildText: '#قناة نصية',
  GuildCategory: '#تصنيف',
};

/* All addXOption chains in a slice of source, each reduced to its own body.
   The close paren of each callback is found by counting nesting, so an option
   whose description contains a paren does not truncate the one after it. */
function readOptions(src) {
  const found = [];
  ARG_ADD.lastIndex = 0;
  let m;
  while ((m = ARG_ADD.exec(src))) {
    let i = ARG_ADD.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const o = readOption(m[1], src.slice(ARG_ADD.lastIndex, i - 1));
    if (o) found.push(o);
    ARG_ADD.lastIndex = i;   // resume past this option's closing paren
  }
  return found;
}

function argToken(o) {
  // The syntax line is read left-to-right in an LTR block, so it carries no
  // Arabic type words — <user> already says member and [delete_days:0-7]
  // already says the bound.
  const range = o.min !== undefined && o.max !== undefined ? `:${o.min}-${o.max}`
    : o.max !== undefined ? `:${o.max - (o.max > 20 ? 1 : 0)}+`
    : o.min !== undefined ? `:${o.min}+` : '';
  return (o.required ? `<${o.name}>` : `[${o.name}]`) + range;
}

function sampleFor(o) {
  if (o.choices?.length) return o.choices[0];
  const byType = SAMPLE[o.name + ':' + o.type];
  if (byType !== undefined) return byType;
  if (SAMPLE[o.name] !== undefined) return SAMPLE[o.name];
  if (o.type === 'Channel') {
    const t = o.channelTypes?.[0];
    return (t && CHANNEL_SAMPLE[t]) || '#قناة';
  }
  if (o.type === 'Boolean') return 'true';
  if (o.min !== undefined && o.min > 0) return String(o.min);
  if (o.max !== undefined && o.max <= 20) return String(o.max);
  switch (o.type) {
    case 'User': return '@عضو';
    case 'Role': return '@رتبة';
    case 'Integer':
    case 'Number': return String(o.min !== undefined ? o.min : 0);
    default: break;
  }
  if (/url|link/.test(o.name)) return 'https://example.com/channel';
  if (/reason|سبب/.test(o.name)) return 'السبب';
  if (/nick/.test(o.name)) return 'لقب جديد';
  if (/message|رسالة/.test(o.name)) return 'رسالة الإشعار';
  if (/^id$/.test(o.name)) return '1';
  return 'نص';
}

function build(prefix, options, out) {
  const req = options.filter(o => o.required);
  const all = options;
  const minimal = [prefix, ...req.map(sampleFor)].join(' ');
  out.examples.push(minimal);
  if (all.length > req.length) {
    const full = [prefix, ...all.map(sampleFor)].join(' ');
    if (full !== minimal) out.examples.push(full);
  }
  out.syntax.push([prefix, ...all.map(argToken)].join(' '));
}

function parseFile(file, category) {
  const raw = readFileSync(file, 'utf-8');
  // Only the data export describes the command; execute() bodies are behaviour.
  const cut = raw.search(/export\s+(async\s+)?function\s+execute/);
  const src = cut > 0 ? raw.slice(0, cut) : raw;

  const nm = src.match(/\.setName\(\s*['"`](.+?)['"`]\s*\)/);
  if (!nm) return null;
  const name = nm[1];

  const permBlock = src.match(/setDefaultMemberPermissions\(([\s\S]*?)\)/);
  const flags = permBlock ? [...permBlock[1].matchAll(/PermissionFlagsBits\.(\w+)/g)].map(m => m[1]) : [];

  const out = { syntax: [], examples: [], args: [] };

  // Subcommands carry their own options; a flat command carries its own here.
  const subStarts = [...src.matchAll(/\.addSubcommand\(\s*sub\s*=>/g)];
  if (subStarts.length) {
    for (let i = 0; i < subStarts.length; i++) {
      const from = subStarts[i].index + subStarts[i][0].length;
      const to = i + 1 < subStarts.length ? subStarts[i + 1].index : src.length;
      const chunk = src.slice(from, to);
      const sn = chunk.match(/\.setName\(\s*['"`](.+?)['"`]/);
      if (!sn) continue;
      const subName = sn[1];
      const opts = readOptions(chunk);
      build(`/${name} ${subName}`, opts, out);
      out.args.push({ sub: subName, options: opts });
    }
  } else {
    const opts = readOptions(src);
    build(`/${name}`, opts, out);
    out.args.push({ sub: null, options: opts });
  }

  return {
    [name]: {
      category,
      syntax: out.syntax.join('\n'),
      examples: out.examples,
      permission: flags.length ? flags.map(f => PERMISSION_AR[f] || f).join(' أو ') : null,
      permissionFlag: flags.join(' | ') || null,
      args: out.args.map(a => ({
        sub: a.sub,
        options: a.options.map(o => ({
          name: o.name,
          type: TYPE_AR[o.type] || o.type,
          required: o.required,
          choices: o.choices || null,
          min: o.min, max: o.max,
          desc: o.desc || null,
        })),
      })),
    },
  };
}

if (!statSync(BOT_DIR).isDirectory()) {
  console.error(`bot command folder not found: ${BOT_DIR}`);
  console.error('pass it explicitly: node scripts/gen-command-usage.mjs <path>/src/commands');
  process.exit(1);
}

const all = {};
let files = 0;
for (const cat of readdirSync(BOT_DIR)) {
  const dir = path.join(BOT_DIR, cat);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const got = parseFile(path.join(dir, f), cat);
    if (got) { Object.assign(all, got); files++; }
  }
}

const sorted = Object.fromEntries(Object.keys(all).sort().map(k => [k, all[k]]));
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(sorted, null, 1) + '\n', 'utf8');

const withArgs = Object.values(sorted).filter(c => c.args.some(a => a.options.length)).length;
const withPerm = Object.values(sorted).filter(c => c.permission).length;
const withSub = Object.values(sorted).filter(c => c.args.some(a => a.sub)).length;
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`  ${files} commands, ${withArgs} with arguments, ${withSub} with subcommands, ${withPerm} with a permission`);