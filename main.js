import { app, BrowserWindow, BrowserView, ipcMain, session } from "electron";
import path from "path";
import Database from "better-sqlite3";
import { autoUpdater } from "electron-updater";
import contextMenu from "electron-context-menu";

const userDataPath = app.getPath("userData");
const dbPath = path.join(userDataPath, "accounts.db");
//const dbPath = "accounts.db";
// Initialize the database
const db = new Database(dbPath);

// Create the accounts table if it doesn't exist
db.prepare(`
    CREATE TABLE IF NOT EXISTS accounts
    (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT,
        url       TEXT,
        partition TEXT,
        iconPath  TEXT,
        iconSet   TEXT
    )
`).run();

let mainWindow;
let views = {};
let currentAccount = null;
const sidebarWidth = 75;
let accountCount = 0;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    // For development purposes
    //mainWindow.webContents.openDevTools({ mode: "detach" });

    // Load the index.html file
    mainWindow.loadFile("index.html");

    // Configurez les mises à jour automatiques
    autoUpdater.checkForUpdatesAndNotify();

    // Load existing accounts from the database
    const accounts = db.prepare("SELECT * FROM accounts").all();
    accountCount = accounts.length;
    accounts.forEach(account => {
        addAccount(account.name, account.url, account.partition, account.iconPath, account.iconSet, false);
    });

    // Reziing the views when the window is resized
    mainWindow.on("resize", () => {
        if (currentAccount) {
            updateViewBounds();
        }
    });

    // Assurez-vous également de mettre à jour la vue lorsqu'elle est maximisée
    mainWindow.on("maximize", () => {
        updateViewBounds();
    });

    mainWindow.on("unmaximize", () => {
        updateViewBounds();
    });

    mainWindow.on("enter-full-screen", () => {
        updateViewBounds();
    });

    mainWindow.on("leave-full-screen", () => {
        updateViewBounds();
    });
}

function addAccount(name, url, partition, iconPath, iconSet, saveToDB = true) {
    // Check if an account with the same name already exists
    if (views[name]) {
        console.error("Un compte avec le même nom existe déjà.");
        return;
    }


    const view = new BrowserView({
        webPreferences: {
            partition: partition,
        },
    });

    view.webContents.loadURL(url);
    views[name] = view;
    if (Object.keys(views).length === 1) {
        // Si c'est le premier compte, l'afficher directement
        switchAccount(name);
    }

    // Une fois la page chargée, récupérer l'image de profil
    view.webContents.on("did-finish-load", () => {
        view.webContents.executeJavaScript(`
      // Chercher l'image de profil sur Gmail
      (function() {
        const profileImgElement = document.getElementsByClassName('gb_M gbii');
        if (profileImgElement.length > 0) {
            return [profileImgElement[0].src, profileImgElement[0].srcset];
        }
        return null;
      })();
    `).then((profileImagesUrl) => {
            if (profileImagesUrl !== null && profileImagesUrl.length > 0) {
                // Envoyer l'URL de l'image de profil à la fenêtre principale
                mainWindow.webContents.send("profile-image", {
                    name,
                    iconSrc: profileImagesUrl[0],
                    iconSet: profileImagesUrl[1],
                });
                db.prepare("UPDATE accounts SET iconPath = ?, iconSet = ? WHERE name = ?").run(profileImagesUrl[0], profileImagesUrl[1], name);
            } else {
                // Si l'image de profil n'est pas trouvée, utiliser l'icône par défaut
                mainWindow.webContents.send("add-icon", { name, iconPath, iconSet });
            }
        }).catch((error) => {
            console.error("Erreur lors de la récupération de l'image de profil :", error);
        });
    });

    mainWindow.webContents.send("add-icon", { name, iconPath, iconSet }); // Vous pouvez définir une icône par défaut ici

    // Save the account information in the database
    if (saveToDB) {
        db.prepare("INSERT INTO accounts (name, url, partition, iconPath, iconSet) VALUES (?, ?, ?, ?, ?)").run(name, url, partition, iconPath, iconSet);
    }
}

// Fonction pour nettoyer le cache de l'application
function clearAppCache() {
    session.defaultSession.clearCache().then(() => {
        console.log("Cache cleared!");
    }).catch((error) => {
        console.error("Failed to clear cache:", error);
    });
}

// Exemple d'utilisation de la fonction de nettoyage de cache
ipcMain.on("clear-cache", () => {
    clearAppCache();
});


function updateViewBounds() {
    if (!currentAccount) return;
    const view = views[currentAccount];
    const [width, height] = mainWindow.getContentSize();
    view.setBounds({ x: sidebarWidth, y: 0, width: width - sidebarWidth, height: height });
}

function switchAccount(name) {
    if (currentAccount) {
        mainWindow.removeBrowserView(views[currentAccount]);
    }
    mainWindow.addBrowserView(views[name]);
    const [width, height] = mainWindow.getContentSize();
    views[name].setBounds({ x: sidebarWidth, y: 0, width: width - sidebarWidth, height: height });
    views[name].setAutoResize({ width: true, height: true });
    currentAccount = name;
}

// Écouteur pour ajouter un nouveau compte
ipcMain.on("add-new-account", () => {
    accountCount++;
    const accountName = `Compte ${accountCount}`;
    const accountURL = "https://mail.google.com";  // Par défaut, utiliser Gmail pour le nouveau compte
    const accountPartition = `persist:account${accountCount}`;

    addAccount(accountName, accountURL, accountPartition, "assets/defaultIcon.jpeg", "assets/defaultIcon.jpeg");
});

// Gestion de la suppression d'un compte
ipcMain.on("delete-account", (event, name) => {
    // Supprimer le compte de la base de données
    db.prepare("DELETE FROM accounts WHERE name = ?").run(name);

    // Supprimer la vue associée
    if (views[name]) {
        mainWindow.removeBrowserView(views[name]);
        delete views[name];
    }

    // Envoyer un message au rendu pour supprimer l'icône
    mainWindow.webContents.send("remove-icon", name);

    console.log(`Compte ${name} supprimé.`);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.on("switch-account", (event, name) => {
    switchAccount(name);
});
