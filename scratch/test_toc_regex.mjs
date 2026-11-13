const text = `
01Real  Numbers15June1 - 28
02Sets08June29 - 50
03Polynomials 08July51 - 76
04Pair of Linear Equations in15September77 - 104
Two  Variables
05Quadratic Equations12October105 - 128
06Progressions11January129 - 162
07Coordinate  Geometry12November163- 194
08Similar Triangles18July, August195 - 228
09Tangents and Secants to a Circle15November229 - 248
10Mensuration10December249 - 272
11Trigonometry15August273 - 297
12Applications of Trigonometry08September298 - 308
13Probability10January309 - 326
14Statistics15July327 - 356
`;

function parseTOC(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const chapters = [];
  let currentChap = null;

  for (const line of lines) {
    if (/^(CHAPTER|NUMBER|CONTENTS|SCERT|TELANGANA)/i.test(line)) continue;
    const match = line.match(/^0?(\d{1,2})\s*([A-Za-z][A-Za-z\s,\-–]+)/);
    if (match) {
      const chapNum = parseInt(match[1], 10);
      let rawTitle = match[2]
        .replace(/\d+.*$/, '')
        .replace(/(June|July|August|September|October|November|December|January|February|March|April|May).*$/i, '')
        .trim();
      currentChap = { number: chapNum, name: rawTitle };
      chapters.push(currentChap);
    } else if (currentChap && /^[A-Za-z\s]+$/.test(line) && !line.includes('SCERT')) {
      currentChap.name = (currentChap.name + ' ' + line.trim()).replace(/\s+/g, ' ');
    }
  }
  return chapters;
}

const res = parseTOC(text);
console.log('Parsed chapters count:', res.length);
res.forEach(c => console.log(`Chapter ${c.number}: ${c.name}`));

