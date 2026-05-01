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

console.log("🚀 Lancement de BOT PDF V1.1...");

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());

// --- GESTION DE LA PERSISTENCE ---
const dataDir = path.join(__dirname, '.data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const DB_FILE = path.join(dataDir, 'database.json');
let pdfLibrary = [];
let downloadHistory = []; 

// Cache pour l'indexation par lot (30 secondes de mémoire pour les hashtags)
const userTagCache = new Map();

if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        pdfLibrary = data.files || [];
        downloadHistory = data.history || [];
        console.log(`✅ Base chargée : ${pdfLibrary.length} fichiers.`);
    } catch (err) {
        pdfLibrary = [];
        downloadHistory = [];
    }
}

const saveDatabase = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify({ files: pdfLibrary, history: downloadHistory }, null, 2));
    } catch (err) {
        console.error('❌ Erreur sauvegarde:', err);
    }
};

let botInfo = null;
bot.telegram.getMe().then(me => { botInfo = me; });

// --- LOGIQUE DU BOT ---
bot.start(async (ctx) => {
    const payload = ctx.payload;
    if (payload && payload.startsWith('dl_')) {
        const file = pdfLibrary.find(f => f.id === payload.replace('dl_', ''));
        if (file) {
            const now = Date.now();
            file.downloads = (file.downloads || 0) + 1;
            downloadHistory.push({ id: file.id, timestamp: now });
            saveDatabase();
            await ctx.reply(`🚀 Envoi en cours : ${file.title}`);
            await ctx.sendDocument(file.fileId);
        }
        return;
    }
    ctx.reply('📚 Bienvenue dans votre Bibliothèque PDF !');
});

bot.on('document', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const userId = ctx.from.id.toString();
    if (chatId !== STORAGE_GROUP_ID && !ADMIN_IDS.includes(userId)) return;

    const doc = ctx.message.document;
    const caption = ctx.message.caption || '';
    const tags = caption.match(/#\S+/g) || [];
    const clean = (t) => t ? t.replace('#', '').replace(/_/g, ' ').toUpperCase() : null;
    const now = Date.now();

    let finalTags = tags;

    // SYSTEME DE LOT : Si des tags sont présents, on les mémorise et on met à jour les fichiers récents "NON CLASSÉ"
    if (tags.length > 0) {
        userTagCache.set(userId, { tags: tags, time: now });
        
        // Correction rétroactive pour le lot actuel (fichiers reçus il y a moins de 30s)
        pdfLibrary.forEach(f => {
            if (f.uploadedBy === userId && f.category === 'NON CLASSÉ' && (now - f.timestamp < 30000)) {
                f.category = clean(tags[0]) || 'NON CLASSÉ';
                f.subCat = clean(tags[1]);
                f.subSubCat = clean(tags[2]);
            }
        });
    } else {
        // Si pas de tags, on regarde si l'utilisateur a envoyé des tags il y a moins de 30s
        const cached = userTagCache.get(userId);
        if (cached && (now - cached.time < 30000)) {
            finalTags = cached.tags;
        }
    }

    const newEntry = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        title: doc.file_name.replace(/\.pdf$/i, '').replace(/_/g, ' '),
        category: clean(finalTags[0]) || 'NON CLASSÉ',
        subCat: clean(finalTags[1]),
        subSubCat: clean(finalTags[2]),
        fileId: doc.file_id,
        downloads: 0,
        uploadedBy: userId, // Nécessaire pour le système de lot
        timestamp: now
    };

    pdfLibrary.push(newEntry);
    saveDatabase();
    
    // On ne répond qu'une fois pour les lots (si tags présents ou premier fichier)
    if (tags.length > 0 || !userTagCache.has(userId)) {
        ctx.reply(`✅ Archivé dans ${newEntry.category}`);
    }
});

// --- API POUR L'INTERFACE ---
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
        top10: [...pdfLibrary]
            .sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
            .slice(0, 10)
            .map(f => ({ title: f.title, downloads: f.downloads || 0 }))
    });
});

app.get('/', (req, res) => res.send('Serveur V1.1 Opérationnel 🚀'));
app.listen(PORT, '0.0.0.0', () => console.log(`📡 Port ${PORT}`));
bot.launch();
