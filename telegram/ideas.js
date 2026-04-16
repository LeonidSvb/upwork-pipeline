const CATEGORIES = ['upwork', 'product', 'outreach', 'learning', 'business', 'life', 'other'];

async function processWithLLM(rawText) {
  const res = await fetch(`${process.env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      messages: [
        {
          role: 'user',
          content: `Process this raw idea and return JSON only, no markdown, no explanation.

Raw idea: "${rawText}"

Categories: ${CATEGORIES.join(', ')}

Return:
{
  "title": "short action-oriented title, max 7 words",
  "category": "one category from the list",
  "priority": "high|medium|low"
}

Priority rules: high = time-sensitive or high-impact, medium = worth doing soon, low = someday/maybe`,
        },
      ],
    }),
  });

  const data = await res.json();
  const raw = data.choices[0].message.content.trim();
  const content = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(content);
}

async function saveToAirtable(data) {
  const res = await fetch(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          title: data.title,
          raw: data.raw,
          category: data.category,
          priority: data.priority,
          status: 'new',
          date: new Date().toISOString().split('T')[0],
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err));
  }
}

export async function handleIdea(api, msg) {
  const rawText = msg.text?.trim();
  if (!rawText) return;

  try {
    const processed = await processWithLLM(rawText);
    await saveToAirtable({ ...processed, raw: rawText });

    await api('sendMessage', {
      chat_id: msg.chat.id,
      message_thread_id: msg.message_thread_id,
      text: `Saved\n\n${processed.title}\n${processed.category} | ${processed.priority}`,
    });
  } catch (err) {
    console.error('[ideas] error:', err.message);
    await api('sendMessage', {
      chat_id: msg.chat.id,
      message_thread_id: msg.message_thread_id,
      text: 'Failed to save, try again',
    });
  }
}
