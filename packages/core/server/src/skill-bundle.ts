import { gzipSync } from "node:zlib";
import { buildSkillMd, type Skill } from "@markbase/protocol/skills";
import type { SkillFile } from "@markbase/protocol/skill-files";

// Assemble a skill's full directory into a .tar.gz, in memory, with no external
// tar dependency. The archive expands to <name>/SKILL.md plus every bundled
// file (scripts/, references/, assets/, …) at its relative path — so an agent
// can install a complete skill in one command:
//   curl .../skills/<name>/install | bash   →   tar -xz into ~/.claude/skills/

// A fixed mtime keeps bundles byte-stable across requests (no spurious diffs).
const MTIME = 0;

function octal(value: number, digits: number): string {
  return value.toString(8).padStart(digits, "0");
}

// One 512-byte USTAR header. Paths longer than 100 bytes use the prefix field.
function header(name: string, size: number, mode: number): Buffer {
  const buf = Buffer.alloc(512, 0);

  const nameBytes = Buffer.from(name, "utf8");
  if (nameBytes.length <= 100) {
    nameBytes.copy(buf, 0);
  } else {
    let split = -1;
    for (let i = Math.min(name.length - 1, 155); i > 0; i--) {
      if (name[i] === "/" && Buffer.from(name.slice(i + 1)).length <= 100) {
        split = i;
        break;
      }
    }
    if (split < 0) throw new Error(`Path too long for tar: ${name}`);
    Buffer.from(name.slice(split + 1), "utf8").copy(buf, 0);
    Buffer.from(name.slice(0, split), "utf8").copy(buf, 345); // prefix[155]
  }

  buf.write(octal(mode & 0o7777, 7) + "\0", 100, 8, "ascii"); // mode
  buf.write(octal(0, 7) + "\0", 108, 8, "ascii"); // uid
  buf.write(octal(0, 7) + "\0", 116, 8, "ascii"); // gid
  buf.write(octal(size, 11) + "\0", 124, 12, "ascii"); // size
  buf.write(octal(MTIME, 11) + "\0", 136, 12, "ascii"); // mtime
  buf.write("        ", 148, 8, "ascii"); // chksum placeholder (spaces)
  buf.write("0", 156, 1, "ascii"); // typeflag: normal file
  buf.write("ustar\0", 257, 6, "ascii"); // magic
  buf.write("00", 263, 2, "ascii"); // version

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(octal(sum, 6) + "\0 ", 148, 8, "ascii"); // chksum: 6 octal + NUL + space

  return buf;
}

function entry(name: string, content: string, mode: number): Buffer {
  const data = Buffer.from(content, "utf8");
  const pad = (512 - (data.length % 512)) % 512;
  return Buffer.concat([
    header(name, data.length, mode),
    data,
    Buffer.alloc(pad, 0),
  ]);
}

// Files placed under "<name>/" so extraction with `tar -xz` recreates the skill
// directory. SKILL.md (the Instructions) is rendered from the skill body.
export function buildSkillTarball(
  skill: Pick<
    Skill,
    "name" | "description" | "body" | "version" | "extra_frontmatter"
  >,
  files: SkillFile[]
): Buffer {
  const dir = skill.name;
  const blocks: Buffer[] = [
    entry(`${dir}/SKILL.md`, buildSkillMd(skill), 0o644),
  ];
  for (const f of files) {
    blocks.push(entry(`${dir}/${f.path}`, f.content, f.executable ? 0o755 : 0o644));
  }
  // Two zero blocks terminate the archive.
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}
