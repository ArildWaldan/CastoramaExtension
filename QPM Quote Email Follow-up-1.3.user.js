// ==UserScript==
// @name         QPM Quote Email Follow-up
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Adds an "Email" button to quote rows in QPM to generate a follow-up email.
// @match        https://qpm-web-internal-agce-prod.k8s.ap.digikfplc.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      squareclock-internal-sqc-production.k8s.ap.digikfplc.com
// @connect      api.kingfisher.com
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = 'QPM Follow-up';
    const POLLING_INTERVAL_TABLE_SCAN_MS = 2000; // Scan for new rows every 2 seconds

    // --- Store & Email Constants ---
    const STORE_NAME = "Castorama Jouy-aux-Arches";
    const STORE_EMAIL_SIGNATURE_TEAM = "L'équipe menuiserie";
    const STORE_EMAIL_CC = "metz2.menuiserie@castorama.fr"; // CC for the email

    // --- DOM Selectors based on provided HTML structure ---
    const QUOTE_TABLE_ROW_SELECTOR = 'table.v-data-table tbody tr.v-data-table__mobile-table-row';
    // Selectors used internally within functions:
    // Quote ID: 'td.v-data-table__mobile-row:nth-child(2) div.v-data-table__mobile-row__cell span:first-child'
    // Status:   'td.v-data-table__mobile-row:nth-child(5) div.v-data-table__mobile-row__cell span'


    const HTML_EMAIL_TEMPLATE_FOLLOW_UP = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Relance devis Castorama</title>
<style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; }
    table { border-collapse: collapse; }
    img { display: block; border: 0; /* Important pour éviter les espaces sous les images */ }
    .main-table {
        margin: auto;
        background-color: #ffffff;
        font-family: Arial, Helvetica, sans-serif;
        color: #333333;
        font-size: 14px;
        line-height: 1.5;
    }
    .header-logo { padding: 20px 0; text-align: center; background-color: #ffffff; }
    .banner-image-cell { padding: 0; /* Assure qu'il n'y a pas d'espace autour de l'image du bandeau */ }
    .title-banner { background-color: #FFDC00; /* Jaune Castorama */ padding: 10px; text-align: center; }
    .title-banner h1 { color: #0078D7; /* Bleu Castorama */ margin: 0; font-size: 22px; font-weight: bold; }
    .title-banner p { color: #005A9E; /* Bleu plus foncé pour contraste */ margin-top: 5px; font-size: 14px; }
    .content-padding { padding: 20px 20px; } /* Increased padding */
    .section-content h2 { color: #0078D7; font-size: 18px; margin-top: 0; margin-bottom: 8px; }
    .section-content p { margin-top: 0; margin-bottom: 5px; }
    .footer { background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 12px; color: #A3A1A1; }
</style>
</head>
<body>
<table width="640" role="presentation" class="main-table" cellspacing="0" cellpadding="0" border="0" align="center">
    <tr>
        <td class="header-logo">
            <a href="https://www.castorama.fr" target="_blank">
                <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/NPS/NPS_Carte_Payante/1.png" alt="Castorama" width="200" style="margin:auto;">
            </a>
        </td>
    </tr>
    <tr>
        <td class="banner-image-cell">
            <img src="https://media.castorama.fr/is/image/KingfisherDigital/installation-01-FR~ddc66bfbcd9d9f6db02ee299cb0b96b07ebd0b66?$WCMS_NPI_FW_XL$" alt="Bandeau Installation Castorama" width="640" style="width: 100%; max-width: 640px; height: auto;">
        </td>
    </tr>
    <tr>
        <td class="title-banner">
            <h1>Suivi de votre projet</h1>
            <p>Nous restons à votre écoute</p>
        </td>
    </tr>
    <tr>
        <td class="content-padding">
            <p style="margin-bottom: 20px;">Bonjour [Nom du client],</p>

            <p style="margin-bottom: 15px;">Je me permets de revenir vers vous concernant notre devis du <strong>[date du devis]</strong> (référence [Numéro du devis]), relatif à <strong>[description rapide du projet]</strong>.</p>

            <p style="margin-bottom: 15px;">Nous n’avons pas encore eu de retour de votre part et souhaitons savoir si ce projet est toujours d’actualité de votre côté. Si ce n’est plus le cas, n’hésitez pas à nous en indiquer la raison : changement de priorités, budget, choix d’un autre prestataire, etc. Cela nous permet de mieux comprendre vos besoins et d’adapter nos offres à l’avenir.</p>

            <p style="margin-bottom: 15px;">Pour rappel, le montant du devis était de <strong>[montant en € TTC]</strong>, pour <strong>[récapitulatif succinct de la prestation]</strong>.</p>

            <p style="margin-bottom: 30px;">Nous restons bien entendu disponibles pour toute question ou ajustement éventuel.</p>

            <p>Dans l’attente de votre retour,</p>

            <p style="margin-top: 15px;">
                Bien cordialement,<br><br>
                <strong>${STORE_EMAIL_SIGNATURE_TEAM}</strong><br>
                ${STORE_NAME}<br>
            </p>
        </td>
    </tr>
    <tr>
        <td class="footer">
            <p>${STORE_NAME} - ZAC Belle Fontaine, 57130 Jouy-aux-Arches</p>
            <p>© [Année actuelle] Castorama France. Tous droits réservés.</p>
        </td>
    </tr>
</table>
</body>
</html>`;

    const API_BASE_URL_SQC = 'https://squareclock-internal-sqc-production.k8s.ap.digikfplc.com';
    const API_BASE_URL_KF = 'https://api.kingfisher.com';
    const QUOTATION_API_PATH = '/api/carpentry/Order/Quotation';
    const CAFR_API_PATH = '/colleague/v2/customers/CAFR';
    let latestAuthToken = null;

    GM_addStyle(`
        .gm-qpm-email-button {
            background-color: #0078D7;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
            /* margin-left: 8px; remove if button is in its own cell content div */
        }
        .gm-qpm-email-button:hover {
            background-color: #005A9E;
        }
        .gm-qpm-email-button:disabled {
            background-color: #cccccc;
            cursor: not-allowed;
        }
        td.gm-qpm-button-cell .v-data-table__mobile-row__cell { /* Style for the cell content div */
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
        }
    `);

    function log(message, ...args) { console.log(`[${SCRIPT_NAME}] ${message}`, ...args); }
    function warn(message, ...args) { console.warn(`[${SCRIPT_NAME}] ${message}`, ...args); }
    function error(message, ...args) { console.error(`[${SCRIPT_NAME}] ${message}`, ...args); }

    async function copyHtmlToClipboard(htmlString) {
        try {
            if (navigator.clipboard && navigator.clipboard.write) {
                const blobHtml = new Blob([htmlString], { type: 'text/html' });
                const clipboardItem = new ClipboardItem({ 'text/html': blobHtml });
                await navigator.clipboard.write([clipboardItem]);
                log("HTML successfully copied to clipboard as rich text.");
                return true;
            }
            throw new Error('navigator.clipboard.write for HTML not fully supported or available.');
        } catch (err) {
            warn("Failed to copy HTML as rich text:", err.message);
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(htmlString);
                } else if (typeof GM_setClipboard !== 'undefined') {
                    GM_setClipboard(htmlString);
                } else {
                    throw new Error('No clipboard write method available.');
                }
                warn("Copied HTML source as plain text.");
                GM_notification({ title: SCRIPT_NAME + " Info", text: "Le code HTML du mail a été copié comme texte brut.", timeout: 8000 });
                return 'plaintext';
            } catch (fallbackErr) {
                error("Failed to copy as plain text (fallback):", fallbackErr);
                GM_notification({ title: SCRIPT_NAME + " Erreur", text: "Échec total de la copie dans le presse-papiers.", timeout: 8000 });
                return false;
            }
        }
    }

    function formatDate(isoString) {
        if (!isoString) return 'N/A';
        try {
            const date = new Date(isoString);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        } catch (e) {
            error(`Error formatting date: ${isoString}`, e);
            return isoString;
        }
    }

    async function fetchQuotationDetails(quoteId) {
        return new Promise((resolve, reject) => {
            if (!quoteId) { reject("No Quote ID"); return; }
            const url = `${API_BASE_URL_SQC}${QUOTATION_API_PATH}?id=${encodeURIComponent(quoteId)}`;
            log(`Fetching Quotation: ${quoteId} from ${url}`);
            GM_xmlhttpRequest({
                method: "GET", url: url,
                headers: { "Accept": "application/json", "Authorization": latestAuthToken || "" },
                timeout: 20000,
                onload: r => {
                    if (r.status >= 200 && r.status < 300) {
                        try { resolve(JSON.parse(r.responseText)); }
                        catch (e) { error("Parse Quotation JSON error:", e, r.responseText); reject("Parse Quotation error"); }
                    } else { error(`Fetch Quotation error ${r.status}`, r.responseText); reject(`Quotation API error ${r.status}`); }
                },
                onerror: r => { error("Network Quotation error:", r); reject("Network Quotation error"); },
                ontimeout: () => { error("Timeout Quotation"); reject("Timeout Quotation"); }
            });
        });
    }

    async function fetchCustomerDetails(customerId) {
        return new Promise((resolve) => { // Does not reject, resolves with null for graceful degradation
            if (!customerId) { resolve(null); return; }
            if (!latestAuthToken) { warn("No Auth token for CAFR"); resolve(null); return; }
            const idClean = customerId.replace(/^SQ_/, '');
            const url = `${API_BASE_URL_KF}${CAFR_API_PATH}?filter[customerNumber]=${encodeURIComponent(idClean)}&page[number]=1&page[size]=1`;
            log(`Fetching CAFR for: ${idClean} from ${url}`);
            GM_xmlhttpRequest({
                method: "GET", url: url,
                headers: { "Accept": "application/json", "X-Tenant": "CAFR", "Authorization": latestAuthToken },
                timeout: 20000,
                onload: r => {
                    if (r.status >= 200 && r.status < 300) {
                        try {
                            const d = JSON.parse(r.responseText);
                            if (d?.data?.[0]?.attributes) resolve(d.data[0].attributes);
                            else { warn("CAFR structure unexpected/not found:", d); resolve(null); }
                        } catch (e) { error("Parse CAFR JSON error:", e, r.responseText); resolve(null); }
                    } else { error(`Fetch CAFR error ${r.status}`, r.responseText); resolve(null); }
                },
                onerror: r => { error("Network CAFR error:", r); resolve(null); },
                ontimeout: () => { error("Timeout CAFR"); resolve(null); }
            });
        });
    }

    async function handleEmailButtonClick(event) {
        const button = event.target;
        const quoteId = button.dataset.quoteId;
        if (!quoteId) { error("No quote ID for button.", button); GM_notification({ title: SCRIPT_NAME, text: "Erreur: ID devis manquant.", timeout: 5000 }); return; }

        button.disabled = true;
        button.textContent = "Chargement...";

        try {
            const quotationData = await fetchQuotationDetails(quoteId);
            const customerDetails = await fetchCustomerDetails(quotationData?.customerId);

            const clientName = customerDetails ? `${customerDetails.givenName || ''} ${customerDetails.familyName || ''}`.trim() : "Client";
            const clientEmail = customerDetails?.email || "";
            const quoteDate = formatDate(quotationData?.creationDate);

            let productDescription = "votre projet";
            if (quotationData?.categories?.[0]?.products?.[0]?.nameFr) {
                productDescription = quotationData.categories[0].products[0].nameFr;
                if (quotationData.categories[0].products.length > 1) productDescription += " et autres";
            } else if (quotationData?.categories?.[0]?.nameFr) {
                 productDescription = `votre projet ${quotationData.categories[0].nameFr}`;
            }
            const productSummary = productDescription; // Keep summary simple

            let quoteAmount = 0;
            if (typeof quotationData?.totalDiscountPv === 'number') quoteAmount = quotationData.totalDiscountPv;
            else if (typeof quotationData?.totalPV === 'number') quoteAmount = quotationData.totalPV;
            const formattedPrice = quoteAmount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

            let emailHtmlBody = HTML_EMAIL_TEMPLATE_FOLLOW_UP
                .replace(/\[Nom du client\]/g, clientName || "Client")
                .replace(/\[date du devis\]/g, quoteDate)
                .replace(/\[Numéro du devis\]/g, quoteId)
                .replace(/\[description rapide du projet\]/g, productDescription)
                .replace(/\[montant en € TTC\]/g, formattedPrice)
                .replace(/\[récapitulatif succinct de la prestation\]/g, productSummary)
                .replace(/\[Année actuelle\]/g, new Date().getFullYear());

            await copyHtmlToClipboard(emailHtmlBody);
            GM_notification({ title: SCRIPT_NAME, text: `Mail pour ${clientEmail || 'client'} copié! Ouverture client mail...`, timeout: 7000 });

            const mailSubject = `Suivi de votre projet Castorama - Devis ${quoteId}`;
            const mailtoParams = new URLSearchParams();
            if (STORE_EMAIL_CC) mailtoParams.append('cc', STORE_EMAIL_CC);
            mailtoParams.append('subject', mailSubject);
            const mailtoUrl = `mailto:${clientEmail}?${mailtoParams.toString().replace(/\+/g, '%20')}`;
            window.open(mailtoUrl, '_blank');

        } catch (err) {
            error("Error in email process:", err);
            GM_notification({ title: SCRIPT_NAME + " Erreur", text: `Erreur: ${err.message || err}. Voir console.`, timeout: 8000 });
        } finally {
            button.disabled = false;
            button.textContent = "Email";
        }
    }

    function getQuoteIdFromRow(rowElement) {
        const quoteIdElement = rowElement.querySelector('td.v-data-table__mobile-row:nth-child(2) div.v-data-table__mobile-row__cell span:first-child');
        if (quoteIdElement) {
            const potentialId = quoteIdElement.textContent.trim();
            if (/^70\d{8}$/.test(potentialId)) { // Validates 10 digits starting with 70
                return potentialId;
            }
        }
        warn("Could not extract valid Quote ID (10 digits, starts with 70) from row:", rowElement);
        return null;
    }

    function addEmailButtonsToRows() {
        const rows = document.querySelectorAll(QUOTE_TABLE_ROW_SELECTOR);
        let buttonsAddedThisScan = 0;

        rows.forEach(row => {
            if (row.querySelector('.gm-qpm-button-cell')) { // Our custom cell already exists
                return;
            }

            const quoteId = getQuoteIdFromRow(row);
            if (!quoteId) {
                return; // No valid quote ID, or already logged by getQuoteIdFromRow
            }

            const statusElement = row.querySelector('td.v-data-table__mobile-row:nth-child(5) div.v-data-table__mobile-row__cell span');
            const quoteStatus = statusElement ? statusElement.textContent.trim().toLowerCase() : '';
            const allowedStatuses = ["a recontacter", "à relancer"]; // Ensure these are exact matches

            if (!allowedStatuses.includes(quoteStatus)) {
                // Create an empty placeholder cell so we don't re-process this row and to maintain column alignment.
                const emptyCell = document.createElement('td');
                emptyCell.className = 'v-data-table__mobile-row gm-qpm-button-cell gm-qpm-button-cell-empty'; // Mark as processed
                const headerDiv = document.createElement('div');
                headerDiv.className = 'v-data-table__mobile-row__header';
                const cellDiv = document.createElement('div');
                cellDiv.className = 'v-data-table__mobile-row__cell';
                emptyCell.appendChild(headerDiv);
                emptyCell.appendChild(cellDiv);
                row.appendChild(emptyCell);
                return;
            }

            const button = document.createElement('button');
            button.textContent = "Email";
            button.className = 'gm-qpm-email-button';
            button.dataset.quoteId = quoteId;
            button.addEventListener('click', handleEmailButtonClick);

            const newCell = document.createElement('td');
            newCell.className = 'v-data-table__mobile-row gm-qpm-button-cell'; // Mark that we've added our cell

            const cellHeaderDiv = document.createElement('div');
            cellHeaderDiv.className = 'v-data-table__mobile-row__header';
            // cellHeaderDiv.textContent = 'Suivi Email'; // Optional: header text for this new column

            const cellContentDiv = document.createElement('div');
            cellContentDiv.className = 'v-data-table__mobile-row__cell';
            // Styling for centering is now in GM_addStyle
            cellContentDiv.appendChild(button);

            newCell.appendChild(cellHeaderDiv);
            newCell.appendChild(cellContentDiv);

            row.appendChild(newCell);
            buttonsAddedThisScan++;
        });

        if (buttonsAddedThisScan > 0) {
            log(`Added ${buttonsAddedThisScan} email buttons.`);
        }
    }

    // --- Token Interception ---
    const origFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = function(input, init) {
        const url = (typeof input === 'string') ? input : input.url;
        if (url && url.includes(CAFR_API_PATH)) {
            const headers = new Headers(init?.headers);
            const token = headers.get('Authorization');
            if (token && token.toLowerCase().startsWith('bearer ') && latestAuthToken !== token) {
                log("Auth Token captured via fetch (CAFR).");
                latestAuthToken = token;
            }
        }
        return origFetch.apply(this, arguments);
    };
    const origXhrOpen = unsafeWindow.XMLHttpRequest.prototype.open;
    const origSetRequestHeader = unsafeWindow.XMLHttpRequest.prototype.setRequestHeader;
    unsafeWindow.XMLHttpRequest.prototype.open = function(method, url) {
        this._isCafrRequest = (typeof url === 'string' && url.includes(CAFR_API_PATH));
        origXhrOpen.apply(this, arguments);
    };
    unsafeWindow.XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (this._isCafrRequest && header.toLowerCase() === 'authorization' && value?.toLowerCase().startsWith('bearer ') && latestAuthToken !== value) {
            log("Auth Token captured via XHR (CAFR).");
            latestAuthToken = value;
        }
        origSetRequestHeader.apply(this, arguments);
    };

    // --- Initialization & MutationObserver ---
    log(`v${GM_info.script.version} loaded. Monitoring for quote table rows.`);
    GM_notification({ title: SCRIPT_NAME, text: `v${GM_info.script.version} activé.`, timeout: 3000 });

    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                let needsScan = false;
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches(QUOTE_TABLE_ROW_SELECTOR) || node.querySelector(QUOTE_TABLE_ROW_SELECTOR) ||
                            (node.tagName === 'TBODY' && node.closest('table.v-data-table'))) { // If a whole tbody is added
                            needsScan = true;
                            break;
                        }
                    }
                }
                if (needsScan) {
                    // log("MutationObserver detected potential table changes, re-scanning.");
                    addEmailButtonsToRows(); // Re-scan to add buttons to new rows
                    break;
                }
            }
        }
    });

    function observeTable() {
        // Wait for the main table container to ensure it exists before observing
        const tableContainer = document.querySelector('table.v-data-table'); // Or a more specific parent
        if (tableContainer && tableContainer.querySelector('tbody')) {
            addEmailButtonsToRows(); // Initial scan
            observer.observe(tableContainer.querySelector('tbody'), { childList: true, subtree: false }); // Observe tbody for direct children (tr) changes
            // Also observe a higher level for table recreation, if necessary
            // observer.observe(document.body, { childList: true, subtree: true }); // Fallback, but less performant
            log("MutationObserver started on table tbody.");
        } else {
            // log("Table not fully loaded yet, retrying observer setup...");
            setTimeout(observeTable, 500); // Retry if table not found
        }
    }

    // Delay initial execution slightly to ensure page elements are more likely to be ready
    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(observeTable, 500);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(observeTable, 500));
    }

})();