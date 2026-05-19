const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';

export async function summarizeAll(diffs) {
    const summaries = [];

    for (const diff of diffs) {
        console.log(`[summarizer] Summarizing changes for ${diff.competitor} - ${diff.label}`);

        try {
            const summary = await summarize(diff);
            summaries.push({...diff, summary});
        } catch (err) {
            console.error(`[summarizer] Failed to summarize ${diff.competitor} - ${diff.label}: ${err.message}`);
            summaries.push({...diff, summaryError: err.message});
        }
    }
    return summaries;
}

async function summarize(diff) {
    const prompt = buildPrompt(diff);

    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt,
            stream: false,
            format: 'json',
        })
    });

    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    try {
        return JSON.parse(data.response);
    } catch  {

      return {
        summary: data.response,
        significance: 'unknown',
        action_items: [],
      };
    } 
}

function buildPrompt(diff) {
    const lines = [];

    lines.push(`You are a product analyst monitoring changes on each competitor's website.\n`)
    lines.push(`The following changes were detected on ${diff.competitor}'s page - ${diff.label} (${diff.url}):\n`);
        lines.push(`Previous snapshot date: ${diff.previousDate}. Current snapshot date: ${diff.date}.\n`);
    lines.push('');

    if (diff.removedText) {
        lines.push('Removed Text:');
        lines.push(diff.removedText.slice(0, 5000)); // Limit to first 5000 chars
        lines.push('');
    }

    if (diff.addedText) {
        lines.push('Added Text:');
        lines.push(diff.addedText.slice(0, 5000));
        lines.push('');
    }

    lines.push(`Analyze these changes from a business/competitive intelligence perspective.
                Respond ONLY with a valid JSON object (no markdown, no explanation) with these fields:
                {
                    summary: 2-3 sentence plain English summary of what changed,
                    significance: Low, Medium, or High (Based on how much is the importance in the business),
                    reasoning:  Why does this matter competitively
                    action_items: A list of recommended action, action items: [action 1, action 2]
                }
    `);

    return lines.join('\n');
}