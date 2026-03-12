export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { fileData, mediaType, docType, keepLayout } = req.body;

    if (!fileData || !mediaType || !docType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const layoutInstr = keepLayout
      ? 'ΣΗΜΑΝΤΙΚΟ: Στο πεδίο layout_text βάλε το κείμενο με ASCII διάταξη που μιμείται την αρχική δομή (πίνακες με παύλες/│, κεφαλίδες, κενά για στοίχιση).'
      : 'Εξήγαγε καθαρά δεδομένα χωρίς εξτρά μορφοποίηση.';

    const prompts = {
      tax: `Αναλύσε αυτό το φορολογικό έγγραφο. ${layoutInstr}\nΑπάντησε ΜΟΝΟ JSON:\n{"document_type":"...","tax_year":"...","taxpayer":"...","afm":"...","layout_text":"...","fields":[{"label":"...","code":"...","value":"...","category":"..."}],"summary":{"total_income":"...","tax_due":"...","tax_paid":"...","balance":"..."}}`,
      invoice: `Αναλύσε αυτό το τιμολόγιο. ${layoutInstr}\nΑπάντησε ΜΟΝΟ JSON:\n{"document_type":"Τιμολόγιο","invoice_number":"...","date":"...","seller":{"name":"...","afm":"...","address":"..."},"buyer":{"name":"...","afm":"...","address":"..."},"layout_text":"...","fields":[{"label":"...","code":"...","value":"...","category":"..."}],"summary":{"subtotal":"...","vat":"...","total":"...","payment_method":"..."}}`,
      contract: `Αναλύσε αυτό το συμβόλαιο. ${layoutInstr}\nΑπάντησε ΜΟΝΟ JSON:\n{"document_type":"Συμβόλαιο","contract_type":"...","date":"...","parties":[{"role":"...","name":"...","afm":"..."}],"layout_text":"...","fields":[{"label":"...","code":"...","value":"...","category":"..."}],"summary":{"total_value":"...","duration":"...","start_date":"...","end_date":"..."}}`,
      medical: `Αναλύσε αυτό το ιατρικό έγγραφο. ${layoutInstr}\nΑπάντησε ΜΟΝΟ JSON:\n{"document_type":"Ιατρικό","date":"...","patient":"...","doctor":"...","layout_text":"...","fields":[{"label":"...","code":"...","value":"...","category":"..."}],"summary":{"diagnosis":"...","total_cost":"...","insurance_covered":"...","patient_pays":"..."}}`,
      other: `Αναλύσε αυτό το έγγραφο. ${layoutInstr}\nΑπάντησε ΜΟΝΟ JSON:\n{"document_type":"...","date":"...","issuer":"...","layout_text":"...","fields":[{"label":"...","code":"...","value":"...","category":"..."}],"summary":{"key_point_1":"...","key_point_2":"...","total_amount":"..."}}`
    };

    const isImage = mediaType.startsWith('image/');
    const contentBlock = isImage
      ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileData } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: prompts[docType] || prompts.other }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'API Error' });
    }

    const data = await response.json();
    const rawText = data.content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch {
      const m = rawText.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('Parse error');
    }

    return res.status(200).json({ success: true, data: parsed, raw: rawText });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
