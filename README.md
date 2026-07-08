# PHP Project Analyzer

Visualizzatore grafico interattivo per progetti PHP. Analizza la struttura del codice,
le dipendenze tra file, le connessioni al database e fornisce strumenti di pulizia
con backup e ripristino.

## Funzionalità

### 1. Analisi del progetto
- Scansiona ricorsivamente tutti i file PHP del progetto
- Rileva classi, interfacce, trait, enum e funzioni tramite `nikic/php-parser`
- Identifica dipendenze tra file (`use`, `include`, `require`)
- Rileva riferimenti al database (`DB::table()`, `Schema::create()`, query SQL, Eloquent ORM)
- Salva i risultati in cache per riaperture rapide
- Supporto per Laravel, Symfony e progetti PHP generici

### 2. Grafico delle dipendenze (📊 Grafica)
- Nodi per ogni file, colorati per categoria (Controller, Model, View, Config, ecc.)
- Frecce direzionali tra file che mostrano le dipendenze
- Nodo speciale "Database" che raccoglie tutte le connessioni al DB
- Layout automatici: Forzato (`cose`), Albero (`breadthfirst`), Concentrico (`concentric`)
- Barra di ricerca per evidenziare nodi specifici
- Doppio click sullo sfondo per zoomare, doppio click su un nodo per centrarlo
- Ogni nodo mostra la dimensione del file (es. `HomeController (12k)`)
- Menu contestuale sul nodo Database → "Mostra tabelle" per visualizzare il sottografo delle tabelle con colonne e file collegati

### 3. Diagramma ER (🗄️ Diagramma ER)
- Vista schematica di tutte le tabelle del database
- Ogni tabella mostra le colonne estratte dal codice SQL
- Icone per operazione: 🔍 SELECT, ➕ INSERT, ✏️ UPDATE, 🗑️ DELETE
- File sulla sinistra collegati alle tabelle con archi etichettati con le colonne usate
- Navigazione con zoom (scroll), pan (drag) e doppio click per zoomare
- Evidenziazione interattiva: passa il mouse su un file per vedere quali colonne usa in ogni tabella

### 4. Pulizia e Backup (🧹 Pulizia)
- Scansione dei file eliminabili:
  - **Duplicati**: file con MD5 identico
  - **File di test**: percorsi che contengono `test/`, `*Test.php`, `spec/`
  - **File minori**: file più piccoli di 10 byte o con estensioni `.bak`, `.log`, `.tmp`, `.cache`
- Backup automatico in `{userData}/backups/` prima di ogni eliminazione
- Backup con timestamp e ripristino completo con un click
- I file eliminati vengono rimossi dall'analisi in tempo reale (grafico e diagramma si aggiornano)

### 5. Esplora file
- Albero navigabile nella sidebar sinistra
- Filtro per categoria (Controller, Model, View, ecc.)
- Ordinamento per nome o dimensione
- Cerca file per nome
- Allarga/riduci cartelle

### 6. Progetti recenti
- Salvataggio automatico della cronologia (ultimi 20 progetti)
- Riapertura rapida con doppio click
- Pulsante × per rimuovere un progetto dalla cronologia (elimina la cache, non la cartella)

### 7. Pannello laterale
- Selezione di un file → mostra classi, metodi, dipendenze, riferimenti DB
- Click sul nodo Database → mostra elenco tabelle, file collegati e operazioni SQL

## Installazione

```bash
git clone <url-del-repository>
cd php-project-analyzer

# Installa dipendenze Node
npm install

# Installa l'analizzatore PHP
cd analyzer && composer install --no-interaction && cd ..
```

## Utilizzo

```bash
# Modalità sviluppo (Vite + Electron con hot reload)
npm run dev

# Build per produzione
npm run build
```

L'applicazione si avvia con una schermata di benvenuto. Incolla il percorso del progetto
PHP da analizzare e clicca "▶ Analizza". In alternativa usa "📂 Scegli Cartella".

### Requisiti
- Node.js 18+
- PHP 8.1+ (con estensione `mbstring`)
- Composer
- Elektron viene fornito come dipendenza npm

## Stack tecnologico
- **Frontend**: React 18 + TypeScript + Vite
- **Grafico**: Cytoscape.js
- **Backend**: Electron 28
- **Analisi PHP**: nikic/php-parser v5.8
- **Linguaggio analizzato**: PHP (con rilevamento pattern Laravel/SQL/ORM)
