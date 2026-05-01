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

console.log("🚀 Initialisation du serveur...");

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());

// --- GESTION DE LA PERSISTENCE (Base de données) ---
const dataDir = path.join(__dirname, '.data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
    console.log("📁 Dossier de données .data créé.");
}

const DB_FILE = path.join(dataDir, 'database.json');
let pdfLibrary = [];

// Chargement initial des données
if (fs.existsSync(DB_FILE)) {
    try {
        pdfLibrary = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`✅ Base de données chargée : ${pdfLibrary.length} documents.`);
    } catch (err) {
        console.error("❌ Erreur de lecture DB:", err);
        pdfLibrary = [];
    }
}

const saveDatabase = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(pdfLibrary, null, 2));
    } catch (err) {
        console.error('❌ Erreur de sauvegarde:', err);
    }
};

let botInfo = null;
bot.telegram.getMe().then(me => { 
    botInfo = me;
    console.log(`🤖 Bot prêt : @${me.username}`);
});

// --- LOGIQUE DU BOT TELEGRAM ---

bot.start(async (ctx) => {
    const payload = ctx.payload;
    // Gestion du téléchargement direct via lien profond (deep linking)
    if (payload && payload.startsWith('dl_')) {
        const fileIdToFind = payload.replace('dl_', '');
        const file = pdfLibrary.find(f => f.id === fileIdToFind);
        
        if (file) {
            file.downloads = (file.downloads || 0) + 1;
            file.lastDownload = Date.now();
            saveDatabase();
            await ctx.reply(`🚀 Préparation de l'envoi : ${file.title}`);
            await ctx.sendDocument(file.fileId);
        } else {
            await ctx.reply("❌ Désolé, ce document n'est plus disponible.");
        }
        return;
    }
    ctx.reply('📚 Bienvenue dans votre bibliothèque PDF !');
});

// Indexation des documents envoyés dans le groupe de stockage
bot.on('document', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    if (chatId !== STORAGE_GROUP_ID) return;

    const doc = ctx.message.document;
    const caption = ctx.message.caption || '';
    
    // Extraction des catégories via hashtags
    const tags = caption.match(/#\S+/g) || [];
    const cleanTag = (t) => t ? t.replace('#', '').replace(/_/g, ' ').toUpperCase() : null;

    const newEntry = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        title: doc.file_name.replace(/\.pdf$/i, '').replace(/_/g, ' '),
        category: cleanTag(tags[0]) || 'AUTRE',
        subCat: cleanTag(tags[1]),
        subSubCat: cleanTag(tags[2]),
        fileId: doc.file_id,
        downloads: 0,
        timestamp: Date.now()
    };

    pdfLibrary.push(newEntry);
    saveDatabase();
    console.log(`✅ Document indexé : ${newEntry.title}`);
    ctx.reply(`✅ Archivé dans ${newEntry.category}`);
});

// --- ROUTES API POUR L'INTERFACE ---

// Route pour lister les fichiers
app.get('/api/files', (req, res) => {
    res.json({ 
        botUsername: botInfo ? botInfo.username : '', 
        files: pdfLibrary 
    });
});

// Route pour les statistiques (Admin seulement)
app.post('/api/stats', (req, res) => {
    const { adminId } = req.body;
    
    // Vérification de sécurité
    if (!adminId || !ADMIN_IDS.includes(adminId.toString())) {
        return res.status(403).json({ error: "Accès refusé" });
    }

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    const stats = {
        total: pdfLibrary.reduce((acc, curr) => acc + (curr.downloads || 0), 0),
        today: pdfLibrary.reduce((acc, curr) => {
            // On compte les téléchargements récents si l'info est disponible
            if (curr.lastDownload && (now - curr.lastDownload < oneDay)) {
                return acc + 1; // Approximation simplifiée
            }
            return acc;
        }, 0),
        top10: [...pdfLibrary]
            .sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
            .slice(0, 10)
            .map(f => ({ title: f.title, downloads: f.downloads || 0 }))
    };

    res.json(stats);
});

app.get('/', (req, res) => res.send('Serveur de Bibliothèque PDF Opérationnel 🚀'));

// --- LANCEMENT ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 API écoutant sur le port ${PORT}`);
});

bot.launch()
    .then(() => console.log('✅ Bot lancé !'))
    .catch(err => console.error("❌ Erreur de lancement du bot:", err));

// Gestion de l'arrêt propre
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
