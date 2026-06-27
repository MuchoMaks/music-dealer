// Vercel Serverless Function — chemin d'accès : /api/discover
// Garde la clé API côté serveur. La page appelle POST /api/discover, jamais Anthropic directement.
// Variable d'environnement à définir dans Vercel : ANTHROPIC_API_KEY

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST uniquement" });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY manquante dans les variables d'environnement Vercel." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const tracklist = (body && body.tracklist) || "";
  const deep = !!(body && body.deep);
  if (!tracklist) { res.status(400).json({ error: "tracklist manquante" }); return; }

  const biais = deep
    ? "Biais TRÈS fort vers la découverte : uniquement des artistes confidentiels/émergents, jamais de têtes d'affiche."
    : "Biais vers la découverte : l'émergent d'abord, quelques valeurs sûres tolérées.";

  const prompt =
`Tu es un moteur de découverte musicale. Adapte-toi au mood réel de la liste (souvent rap francophone underground : cloud rap, plugg/pluggnb, New Wave, digicore, DMV francophone — mais suis ce que dit la liste).
On te donne une liste (artiste - titre, une par ligne).

1. Lis le MOOD réel en une phrase (le ressenti, pas juste le genre).
2. Propose 12 ARTISTES francophones qui collent à ce mood, en EXCLUANT tout artiste déjà présent dans la liste et les stars mainstream. Pour chacun, propose AUSSI un morceau d'entrée probable (titre) : il sera vérifié ensuite via Spotify, donc reste plausible, n'invente pas de titre farfelu.
3. ${biais}

Réponds UNIQUEMENT en JSON valide, compact, sans aucun texte autour ni backticks :
{"vibe":"...","recommandations":[{"artiste":"...","titre":"...","scene":"..."}]}

Liste :
${tracklist}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const j = await r.json();
    if (!r.ok) { res.status(502).json({ error: "Anthropic " + r.status, detail: j }); return; }

    const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const parsed = extractJSON(text);
    if (!parsed) { res.status(502).json({ error: "Réponse du modèle illisible", raw: text.slice(0, 400) }); return; }
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

function extractJSON(t) {
  if (!t) return null;
  t = t.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { const p = JSON.parse(t); if (p.recommandations) return p; } catch (_) {}
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{") continue;
    let d = 0, s = false, e = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (e) { e = false; continue; }
      if (c === "\\") { e = true; continue; }
      if (c === '"') s = !s;
      if (s) continue;
      if (c === "{") d++;
      else if (c === "}") { d--; if (d === 0) { try { const p = JSON.parse(t.slice(i, j + 1)); if (p.recommandations) return p; } catch (_) {} break; } }
    }
  }
  return null;
}
