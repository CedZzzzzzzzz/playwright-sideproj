import { diffWords } from 'diff';
import fs from 'fs/promises';
import path  from 'path';

const LOGS_DIR = '/app/logs';

export async function diffAll(scrapeResults) {
    const diffs = [];

    for (const result of scrapeResults) {
        if (result.error) continue;
        
        const previous = await loadPreviousSnapshot(result.competitor, result.label);
        if (!previous) {
            console.log(`[differ] No previous snapshot for ${result.competitor} - ${result.label}, skipping diff.`);
            continue;
        }

        const changes = computeDiff(previous.text, result.snapshot.text);
        if (!changes.hasChanges) {
            console.log(`[differ] No changes detected for ${result.competitor} - ${result.label}.`);
            continue;
        }

        console.log(`[differ] Changes detected for ${result.competitor} - ${result.label}.`);

        diffs.push({
            competitor: result.competitor,
            label: result.label,
            url: result.url,
            date: result.snapshot.date,
            previousDate: previous.date,
            ...changes,
        });
    }
    return diffs;
}

function computeDiff(oldText, newText) {
    const parts = diffWords(oldText, newText);

    const added = [];
    const removed = [];

    for (const part of parts) {
        if (part.added) {
            added.push(part.value.trim());
        }
        if (part.removed) {
            removed.push(part.value.trim());
        }
    }

    const addedText = added.filter((s) => s.length > 10).join('\n');
    const removedText = removed.filter((s) => s.length > 10).join('\n');

    return {
        hasChanges: added.length > 0 || removed.length > 0,
        addedText,
        removedText,
        addedWords: added.length,
        removedWords: removed.length,
    };
}

async function loadPreviousSnapshot(competitor, label) {
    const slug = `${competitor}-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    let dates;
    try {
        const entires = await fs.readdir(LOGS_DIR);

        dates = entires
        .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
        .sort()
        .reverse();
    } catch {
        return null;
    }

    const today = new Date().toISOString().split('T')[0];

    for (const date of dates) {
        if (date === today) continue;

        const filepath = path.join(LOGS_DIR, date, `${slug}.json`); 

        try {
            const raw = await fs.readFile(filepath, 'utf-8');
            return JSON.parse(raw);
        } catch {
            continue;
        }
    }
    return null;
}