const fs = require('fs');
const content = fs.readFileSync('data.js', 'utf8');

const islandDataStart = content.indexOf('const ISLAND_DATA = {');
if (islandDataStart === -1) {
  console.log('Could not find ISLAND_DATA');
  process.exit(1);
}

const islandDataEnd = content.indexOf('};', islandDataStart);
const islandDataStr = content.substring(islandDataStart, islandDataEnd + 2);

// Simple regex parser
const islands = [];
const lines = islandDataStr.split('\n');

lines.forEach(line => {
  const nameMatch = line.match(/name:\s*"([^"]+)"/);
  const latMatch = line.match(/lat:\s*(-?\d+(\.\d+)?)/);
  const lngMatch = line.match(/lng:\s*(-?\d+(\.\d+)?)/);

  if (nameMatch && latMatch && lngMatch) {
    islands.push({
      name: nameMatch[1],
      lat: parseFloat(latMatch[1]),
      lng: parseFloat(lngMatch[1])
    });
  }
});

// Check for conflicts
const positionMap = {};
const conflicts = [];

islands.forEach(island => {
  const key = `${island.lat},${island.lng}`;
  if (positionMap[key]) {
    conflicts.push({
      coords: key,
      existing: positionMap[key],
      new: island.name
    });
  } else {
    positionMap[key] = island.name;
  }
});

if (conflicts.length > 0) {
  console.log('Position Conflicts Found:');
  conflicts.forEach(c => {
    console.log(`- ${c.existing} AND ${c.new} at [${c.coords}]`);
  });
} else {
  console.log('No exact position conflicts found.');
}
