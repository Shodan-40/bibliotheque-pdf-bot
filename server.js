const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- CONFIGURATION ---
const BOT_TOKEN = '8715998408:AAFwUot0UYJeZct66cUi0MJRNDt8WSk-86E';
const STORAGE_GROUP_ID = '-1003922829685';
const ADMIN_IDS = ['7966491400']; 
const PORT = process.env.PORT || 3000;

console.log("🚀 Lancement de BOT PDF V2.1 (Reset DB + Interactif)...");

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());

// --- PERSISTENCE ---
const dataDir = path.join(__dirname, '.data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const DB_FILE = path.join(dataDir, 'database.json');

let pdfLibrary = [];
let downloadHistory = []; 
let uploadSessions = new Map(); 

if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        pdfLibrary = data.files || [];
        downloadHistory = data.history || [];
        console.log(`✅ Base chargée : ${pdfLibrary.length} fichiers.`);
    } catch (err) {
        pdfLibrary = []; downloadHistory = [];
    }
}

const saveDatabase = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify({ files: pdfLibrary, history: downloadHistory }, null, 2));
    } catch (err) { console.error('❌ Erreur sauvegarde:', err); }
};

let botInfo = null;
bot.telegram.getMe().then(me => { botInfo = me; });

// --- LOGIQUE DU BOT ---

bot.start(async (ctx) => {
    const payload = ctx.payload;
    if (payload && payload.startsWith('dl_')) {
        const file = pdfLibrary.find(f => f.id === payload.replace('dl_', ''));
        if (file) {
            file.downloads = (file.downloads || 0) + 1;
            downloadHistory.push({ id: file.id, timestamp: Date.now() });
            saveDatabase();
            await ctx.reply(`🚀 Envoi de : ${file.title}`);
            await ctx.sendDocument(file.fileId);
        }
        return;
    }
    ctx.reply('📚 Bienvenue dans votre Bibliothèque !');
});

// COMMANDE DE RÉINITIALISATION (ADMIN UNIQUEMENT)
bot.command('reset_db', (ctx) => {
    const userId = ctx.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) return;

    pdfLibrary = [];
    downloadHistory = [];
    saveDatabase();
    ctx.reply('💥 Base de données et statistiques réinitialisées avec succès !');
});

// Réception des PDF (Mise en attente pour lot)
bot.on('document', async (ctx) => {
    const userId = ctx.from.id.toString();
    if (!ADMIN_IDS.includes(userId)) return;

    if (!uploadSessions.has(userId)) {
        uploadSessions.set(userId, { files: [], timeout: null });
    }

    const session = uploadSessions.get(userId);
    if (session.timeout) clearTimeout(session.timeout);

    session.files.push({
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        title: ctx.message.document.file_name.replace(/\.pdf$/i, '').replace(/_/g, ' '),
        fileId: ctx.message.document.file_id,
        timestamp: Date.now()
    });

    session.timeout = setTimeout(() => {
        ctx.reply(`📂 ${session.files.length} fichier(s) reçu(s).\n\nIndiquez la destination :\n(Ex: 01 ARTICLES / TRADUCTIONS / ...)`);
    }, 3000);
});

// Réception de la catégorie (Validation du lot)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const session = uploadSessions.get(userId);

    if (session && session.files.length > 0) {
        const parts = ctx.message.text.split('/').map(p => p.trim().toUpperCase());
        const cat = parts[0] || 'NON CLASSÉ';
        const sub = parts[1] || null;
        const subSub = parts[2] || null;

        const newEntries = session.files.map(f => ({
            ...f,
            category: cat,
            subCat: sub,
            subSubCat: subSub,
            downloads: 0
        }));

        pdfLibrary.push(...newEntries);
        saveDatabase();
        uploadSessions.delete(userId);
        
        ctx.reply(`✅ Lot de ${newEntries.length} fichiers indexé dans :\n📁 ${cat}${sub ? ' > ' + sub : ''}`);
    }
});

// --- API ---

app.get('/api/files', (req, res) => {
    res.json({ botUsername: botInfo ? botInfo.username : '', files: pdfLibrary });
});

app.post('/api/stats', (req, res) => {
    const { adminId } = req.body;
    if (!adminId || !ADMIN_IDS.includes(adminId.toString())) return res.status(403).json({ error: "Interdit" });
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    res.json({
        total: downloadHistory.length,
        today: downloadHistory.filter(e => now - e.timestamp < DAY).length,
        week: downloadHistory.filter(e => now - e.timestamp < DAY * 7).length,
        month: downloadHistory.filter(e => now - e.timestamp < DAY * 30).length,
        year: downloadHistory.filter(e => now - e.timestamp < DAY * 365).length,
        top10: [...pdfLibrary].sort((a,b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 10).map(f => ({ title: f.title, downloads: f.downloads || 0 }))
    });
});

app.post('/api/delete', (req, res) => {
    const { adminId, fileId } = req.body;
    if (!adminId || !ADMIN_IDS.includes(adminId.toString())) return res.status(403).json({ error: "Interdit" });
    pdfLibrary = pdfLibrary.filter(f => f.id !== fileId);
    saveDatabase();
    res.json({ success: true });
});

app.get('/', (req, res) => res.send('Serveur V2.1 Opérationnel 🚀'));
app.listen(PORT, '0.0.0.0', () => console.log(`📡 Port ${PORT}`));
bot.launch();
