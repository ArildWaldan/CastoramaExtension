// ==UserScript==
// @name         Sur-mesure Scraper
// @namespace    http://tampermonkey.net/
// @version      5.5
// @description  Intercepts Quotation & CAFR. Captures token, uses polling for customer details, sends data (with IMAGE formula & QuotationID for de-duplication) to Sheet, shows popups, and adds an email quote feature.
// @match        https://squareclock-internal-sqc-production.k8s.ap.digikfplc.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      api.kingfisher.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = 'Scraper';
    // !!! IMPORTANT: PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL HERE !!!
    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx6wfRJB2Qay_4g6Ms6NdxVEet9C-LoXya52j35s8g/dev'; // REPLACE WITH YOUR URL
    // !!! IMPORTANT: PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL HERE !!!

    // --- Email Feature Constants ---
    const STORE_NAME = "Castorama Jouy-aux-Arches";
    // !!! IMPORTANT: UPDATE THE STORE PHONE NUMBER BELOW !!!
    const STORE_PHONE = "03 XX XX XX XX"; // REPLACE WITH ACTUAL STORE PHONE for [T]
    // !!! IMPORTANT: UPDATE THE STORE PHONE NUMBER ABOVE !!!
    const STORE_EMAIL_SIGNATURE = "metz2.menuiserie@castorama.fr";
    const STORE_EMAIL_CC = "metz2.menuiserie@castorama.fr";
    const CGV_LINK_URL = "https://www.castorama.fr/services/conditions-generales-de-vente/";
    const PRIVACY_POLICY_URL = "https://www.castorama.fr/services/donnees-personnelles-et-cookies/";

    const HTML_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Votre étude de projet Castorama</title>
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
    .content-padding { padding: 10px 10px; }

    .section {
        border-bottom: 1px solid #eeeeee;
    }
    .section:last-child { border-bottom: none; }

    .section-icon, .section-content {
        vertical-align: top;
        padding-bottom: 25px;
    }

    .section-icon {
        width: 50px;
        padding-right: 15px;
    }
    .section-icon img { width: 40px; height: 40px; }

    .section-content h2 { color: #0078D7; font-size: 18px; margin-top: 0; margin-bottom: 8px; }
    .section-content p { margin-top: 0; margin-bottom: 5px; }

    .footer { background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 12px; color: #A3A1A1; }
</style>
</head>
<body>
    <table width="640" role="presentation" class="main-table" cellspacing="0" cellpadding="0" border="0" align="center">
        <!-- Header avec Logo -->
        <tr>
            <td class="header-logo">
                <a href="https://www.castorama.fr" target="_blank">
                    <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/NPS/NPS_Carte_Payante/1.png" alt="Castorama" width="200" style="margin:auto;">
                </a>
            </td>
        </tr>

        <!-- NOUVEAU BANDEAU IMAGE -->
        <tr>
            <td class="banner-image-cell">
                <img src="https://media.castorama.fr/is/image/KingfisherDigital/installation-01-FR~ddc66bfbcd9d9f6db02ee299cb0b96b07ebd0b66?$WCMS_NPI_FW_XL$" alt="Bandeau Installation Castorama" width="640" style="width: 100%; max-width: 640px; height: auto;">
            </td>
        </tr>

        <!-- Bannière Titre Jaune -->
        <tr>
            <td class="title-banner">
                <h1>Votre étude de projet personnalisée</h1>
                <p>Suite à votre visite au magasin ${STORE_NAME}.</p>
            </td>
        </tr>

        <!-- Contenu Principal -->
        <tr>
            <td class="content-padding">
                <p style="margin-bottom: 20px;">Madame, Monsieur,</p>
                <p style="margin-bottom: 25px;">Comme convenu, veuillez trouver ci-dessous les informations relatives à votre projet :</p>

                <!-- SPACER TABLE (Avant la première section pour l'espace après le titre jaune) -->
                <table width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr><td style="height: 30px; line-height: 30px; font-size: 1px;"> </td></tr>
                </table>

                <!-- Section Devis -->
                <table width="100%" role="presentation" class="section" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                        <td class="section-icon">
                            <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSUdE-O8JM5cqg2cXJ7jO-RqO_s1gNe8CKCVA&s" alt="Devis">
                        </td>
                        <td class="section-content">
                            <h2>Votre Devis Détaillé</h2>
                            <p>Le devis est en pièce jointe, pour un montant total TTC de <strong>[montant]</strong>.</p>
                            <p style="font-size:12px; color:#555;"><em>Ce montant couvre uniquement la fourniture des produits. La pose et la livraison sont en supplément.</em></p>
                        </td>
                    </tr>
                </table>

                <!-- SPACER TABLE -->
                <table width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr><td style="height: 30px; line-height: 30px; font-size: 1px;"> </td></tr>
                </table>

                <!-- Section Délai Livraison -->
                <table width="100%" role="presentation" class="section" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                        <td class="section-icon">
                            <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/Upgrade/Upgrade_Reste_Gratuit_J8/17.png" alt="Livraison" style="width: 45px; height: 45px;">
                        </td>
                        <td class="section-content">
                            <h2>Délai de Livraison Estimé</h2>
                            <p>Le délai pour la livraison est de <strong>8 à 12 semaines</strong> (fabrication et expédition incluses).</p>
                        </td>
                    </tr>
                </table>

                <!-- SPACER TABLE -->
                <table width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr><td style="height: 30px; line-height: 30px; font-size: 1px;"> </td></tr>
                </table>

                <!-- Section Pré-visite -->
                <table width="100%" role="presentation" class="section" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                        <td class="section-icon">
                            <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/Upgrade/Upgrade_Reste_Gratuit_J8/15.png" alt="Pré-visite chantier" style="width: 45px; height: 45px;">
                        </td>
                        <td class="section-content">
                            <h2>Option : Pré-visite de Chantier</h2>
                            <p>Si vous souhaitez aller plus loin, nous pouvons organiser une pré-visite technique pour <strong>45,00 € TTC</strong>.</p>
                            <p>Cette somme sera <strong>remboursée</strong> sur votre commande finale si vous concrétisez votre achat avec nous.</p>
                            <p style="margin-top:15px;">Pour programmer cette pré-visite, n'hésitez pas à passer directement en magasin à votre convenance.</p>
                        </td>
                    </tr>
                </table>

                <!-- SPACER TABLE -->
                <table width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr><td style="height: 30px; line-height: 30px; font-size: 1px;"> </td></tr>
                </table>

                 <!-- Section Suivi -->
                 <table width="100%" role="presentation" class="section" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                        <td class="section-icon">
                            <img src="https://s7g10.scene7.com/is/content/KingfisherDigital/eb13ce534b7148eb031bb4808048a1f04b6e483c" alt="Contact">
                        </td>
                        <td class="section-content">
                            <h2>Suivi de votre projet</h2>
                            <p>Notre équipe se propose de vous recontacter d'ici une semaine pour discuter de l'avancement de votre projet et répondre à vos questions.</p>
                        </td>
                    </tr>
                </table>

                <p style="margin-top: 30px;">Restant à votre disposition pour toute information complémentaire, nous vous remercions de votre confiance.</p>
                <p>Excellente journée,</p>
                <p style="margin-top: 15px;">
                    Cordialement,<br><br>
                    <strong>L'équipe menuiserie</strong><br>
                    <br>
                    ${STORE_NAME}<br>
                    [T]<br>
                    [M]
                </p>
            </td>
        </tr>

        <!-- Pied de page -->
        <tr>
            <td class="footer">
                <p>${STORE_NAME} - ZAC Belle Fontaine, 57130 Jouy-aux-Arches</p>
                <p>© [[Année actuelle]] Castorama France. Tous droits réservés.</p>
                <p>
                    <a href="[LIEN_CONDITIONS_GENERALES]" style="color: #A3A1A1; text-decoration: underline;">Conditions Générales de Vente</a> |
                    <a href="[LIEN_POLITIQUE_CONFIDENTIALITE]" style="color: #A3A1A1; text-decoration: underline;">Politique de confidentialité</a>
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-top:10px;">
                    <tr>
                        <td style="padding: 0 5px;">
                            <a href="https://www.facebook.com/castorama/" target="_blank">
                                <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/NPS/NPS_Carte_Payante/3.png" alt="Facebook" width="30">
                            </a>
                        </td>
                        <td style="padding: 0 5px;">
                            <a href="https://twitter.com/castoramafr" target="_blank">
                                <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/NPS/NPS_Carte_Payante/4.png" alt="Twitter" width="30">
                            </a>
                        </td>
                        <td style="padding: 0 5px;">
                            <a href="https://www.instagram.com/castorama_france/" target="_blank">
                                <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/NPS/NPS_Carte_Payante/5.png" alt="Instagram" width="30">
                            </a>
                        </td>
                         <td style="padding: 0 5px;">
                            <a href="https://www.pinterest.fr/castorama/" target="_blank">
                                <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/NPS/NPS_Carte_Payante/6.png" alt="Pinterest" width="30">
                            </a>
                        </td>
                        <td style="padding: 0 5px;">
                            <a href="https://www.youtube.com/user/castorama" target="_blank">
                                <img src="https://wpm.ccmp.eu/wpm/1166/ContentUploads/Triggers/FID/NPS/NPS_Carte_Payante/7.png" alt="YouTube" width="30">
                            </a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
    // --- End of Email Feature Constants ---

    const API_TYPES = {
        QUOTATION: 'Quotation',
        CAFR: 'CAFR'
    };
    const TARGETS = [
        { name: API_TYPES.QUOTATION, url_pattern: '/api/carpentry/Order/Quotation?id=' },
        { name: API_TYPES.CAFR, url_pattern: '/colleague/v2/customers/CAFR' }
    ];
    const CAFR_API_BASE = 'https://api.kingfisher.com/colleague/v2/customers/CAFR';

    let latestAuthToken = null;
    let pendingCafrData = null;
    let isProcessingCafr = false;
    const POLLING_INTERVAL_MS = 500;
    let pollingIntervalId = null;
    let successPopupTimeoutId = null;
    let loadingPopupElement = null;
    let emailButtonElement = null;
    let latestProcessedDataForEmail = null;

    GM_addStyle(`
        #gm-scraper-success-popup {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: #dff0d8;
            color: #3c763d;
            border: 1px solid #d6e9c6;
            padding: 12px 18px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            z-index: 99999;
            font-family: sans-serif;
            font-size: 18px;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.4s ease-in-out, visibility 0.4s ease-in-out;
        }
        #gm-scraper-success-popup.visible {
            opacity: 1;
            visibility: visible;
        }
        #gm-scraper-success-popup.duplicate {
            background-color: #fcf8e3;
            color: #8a6d3b;
            border-color: #faebcc;
        }
        #gm-scraper-loading-popup {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: #e0e0e0;
            color: #333;
            border: 1px solid #cccccc;
            padding: 12px 18px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            z-index: 99998;
            font-family: sans-serif;
            font-size: 18px;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.4s ease-in-out, visibility 0.4s ease-in-out;
        }
        #gm-scraper-loading-popup.visible {
            opacity: 1;
            visibility: visible;
        }
        #gm-scraper-email-button {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background-color: #0078D7;
            color: white;
            border: none;
            padding: 12px 18px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 99997;
            font-family: sans-serif;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.4s ease-in-out, visibility 0.4s ease-in-out, transform 0.1s ease-out, background-color 0.2s ease;
        }
        #gm-scraper-email-button.visible {
            opacity: 1;
            visibility: visible;
        }
        #gm-scraper-email-button:hover {
            background-color: #005A9E;
            transform: translateY(-1px);
        }
        #gm-scraper-email-button:active {
            background-color: #004C8A;
            transform: translateY(0px);
        }
    `);

    function removeEmailButton() {
        if (emailButtonElement) {
            emailButtonElement.classList.remove('visible');
            const btnToRemove = emailButtonElement;
            setTimeout(() => {
                if (btnToRemove && btnToRemove.parentNode) {
                    btnToRemove.parentNode.removeChild(btnToRemove);
                }
                if (emailButtonElement === btnToRemove) {
                    emailButtonElement = null;
                }
            }, 400);
        }
    }

    function showLoadingPopup(message = "Envoi du devis en cours...") {
        hideLoadingPopup();
        removeEmailButton();

        loadingPopupElement = document.createElement('div');
        loadingPopupElement.id = 'gm-scraper-loading-popup';
        loadingPopupElement.textContent = message;
        document.body.appendChild(loadingPopupElement);

        setTimeout(() => {
            if (loadingPopupElement) loadingPopupElement.classList.add('visible');
        }, 10);
    }

    function hideLoadingPopup() {
        if (loadingPopupElement) {
            loadingPopupElement.classList.remove('visible');
            const popupToRemove = loadingPopupElement;
            setTimeout(() => {
                if (popupToRemove && popupToRemove.parentNode) {
                    popupToRemove.parentNode.removeChild(popupToRemove);
                }
                if (loadingPopupElement === popupToRemove) {
                    loadingPopupElement = null;
                }
            }, 400);
        }
    }

    function showSuccessPopup(message, duration = 6000, isDuplicate = false) {
        const existingPopup = document.getElementById('gm-scraper-success-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        if (successPopupTimeoutId) {
            clearTimeout(successPopupTimeoutId);
        }

        const popup = document.createElement('div');
        popup.id = 'gm-scraper-success-popup';
        popup.textContent = message;
        if (isDuplicate) {
            popup.classList.add('duplicate');
        }
        document.body.appendChild(popup);

        setTimeout(() => {
            popup.classList.add('visible');
        }, 10);

        successPopupTimeoutId = setTimeout(() => {
            popup.classList.remove('visible');
            setTimeout(() => {
                if (document.getElementById('gm-scraper-success-popup') === popup) {
                     popup.remove();
                }
            }, 400);
        }, duration);
    }

    async function copyHtmlToClipboard(htmlString) {
        try {
            if (navigator.clipboard && navigator.clipboard.write) {
                const blobHtml = new Blob([htmlString], { type: 'text/html' });
                const clipboardItem = new ClipboardItem({ 'text/html': blobHtml });
                await navigator.clipboard.write([clipboardItem]);
                console.log(`[${SCRIPT_NAME}] HTML successfully copied to clipboard as rich text.`);
                return true;
            }
            throw new Error('navigator.clipboard.write for HTML not fully supported or available.');

        } catch (err) {
            console.warn(`[${SCRIPT_NAME}] Failed to copy HTML as rich text:`, err.message);
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(htmlString);
                } else if (typeof GM_setClipboard !== 'undefined') {
                    GM_setClipboard(htmlString);
                } else {
                    throw new Error('No clipboard write method available.');
                }
                console.warn(`[${SCRIPT_NAME}] Copied HTML source as plain text due to rich text copy failure or lack of support.`);
                GM_notification({ title: SCRIPT_NAME + " Info", text: "Le code HTML du mail a été copié comme texte brut.", timeout: 8000 });
                return 'plaintext';
            } catch (fallbackErr) {
                console.error(`[${SCRIPT_NAME}] Failed to copy as plain text (fallback):`, fallbackErr);
                GM_notification({ title: SCRIPT_NAME + " Erreur", text: "Échec total de la copie dans le presse-papiers.", timeout: 8000 });
                return false;
            }
        }
    }

    function showEmailButton(processedData) {
        removeEmailButton();

        const { customerEmail, totalAmount, quotationId, nomClient } = processedData;

        emailButtonElement = document.createElement('button');
        emailButtonElement.id = 'gm-scraper-email-button';
        emailButtonElement.textContent = "Envoyer le devis par mail";

        emailButtonElement.onclick = async function() {
            const mailSubject = `Votre étude de projet Castorama - Devis ${quotationId || 'N/A'}`;
            const formattedPrice = (typeof totalAmount === 'number' ? totalAmount : 0)
                .toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

            let emailHtmlBody = HTML_EMAIL_TEMPLATE;
            if (nomClient && nomClient !== 'N/A' && nomClient.trim() !== '') {
                emailHtmlBody = emailHtmlBody.replace(
                    /Madame, Monsieur,/g,
                    `Madame, Monsieur ${nomClient},`
                );
            }
            emailHtmlBody = emailHtmlBody.replace(/\[montant\]/g, formattedPrice);
            emailHtmlBody = emailHtmlBody.replace(/\[\[Année actuelle\]\]/g, new Date().getFullYear());
            emailHtmlBody = emailHtmlBody.replace(/\[T\]/g, STORE_PHONE);
            emailHtmlBody = emailHtmlBody.replace(/\[M\]/g, STORE_EMAIL_SIGNATURE);
            emailHtmlBody = emailHtmlBody.replace(/\[LIEN_CONDITIONS_GENERALES\]/g, CGV_LINK_URL);
            emailHtmlBody = emailHtmlBody.replace(/\[LIEN_POLITIQUE_CONFIDENTIALITE\]/g, PRIVACY_POLICY_URL);

            const copyStatus = await copyHtmlToClipboard(emailHtmlBody);

            let notificationMessage = "Le mail a été copié. Collez-le et ajoutez le PDF.";
            if (copyStatus === 'plaintext') {
                notificationMessage = "Le mail (source HTML) a été copié. Collez-le (en mode HTML si possible) et ajoutez le PDF.";
            } else if (!copyStatus) {
                notificationMessage = "Échec copie presse-papiers. Mailto ouvert. Ajoutez le PDF et rédigez/collez le mail.";
            }
            GM_notification({
                title: SCRIPT_NAME,
                text: notificationMessage,
                timeout: 10000
            });

            const mailtoParams = new URLSearchParams();
            mailtoParams.append('cc', STORE_EMAIL_CC);
            mailtoParams.append('subject', mailSubject);
            // Body is intentionally left empty as per requirement

            let mailtoQueryString = mailtoParams.toString();
            // Replace '+' (from URLSearchParams default space encoding) with '%20' for better mail client compatibility
            mailtoQueryString = mailtoQueryString.replace(/\+/g, '%20');

            const mailtoUrl = `mailto:${customerEmail}?${mailtoQueryString}`;

            window.open(mailtoUrl, '_blank');
            removeEmailButton();
        };

        document.body.appendChild(emailButtonElement);
        setTimeout(() => {
            if (emailButtonElement) emailButtonElement.classList.add('visible');
        }, 10);
    }


    function sendDataToSheet(payload) {
        if (!payload) {
            console.warn(`[${SCRIPT_NAME}] No data payload provided to sendDataToSheet.`);
            hideLoadingPopup();
            removeEmailButton();
            return;
        }
        if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes('PASTE_YOUR')) {
             console.error(`[${SCRIPT_NAME}] Google Apps Script URL is not set! Cannot send data.`);
             hideLoadingPopup();
             removeEmailButton();
             GM_notification({ title: SCRIPT_NAME + " Error", text: "Google Apps Script URL is missing.", timeout: 10000 });
             return;
        }
        console.log(`[${SCRIPT_NAME}] Sending structured data to Google Sheet (Quotation ID: ${payload.QuotationId})...`, payload);
        GM_xmlhttpRequest({
            method: "POST",
            url: GOOGLE_SCRIPT_URL,
            data: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            timeout: 30000,
            onload: function(response) {
                hideLoadingPopup();
                try {
                    const responseText = response.responseText.trim();
                    if (!responseText) {
                        console.error(`[${SCRIPT_NAME}] Error sending data. Empty response from Google Sheet.`);
                        GM_notification({ title: SCRIPT_NAME + " Error", text: `Sheet Error: Empty response. Check GAS script.`, timeout: 10000 });
                        removeEmailButton();
                        return;
                    }
                    const respData = JSON.parse(responseText);
                    if (response.status === 200 && (respData.status === 'success' || respData.status === 'duplicate')) {
                        const successMessage = respData.status === 'success' ? "Devis bien envoyé à l'application de relance" : "Ce devis est déjà enregistré.";
                        const isDuplicate = respData.status === 'duplicate';
                        showSuccessPopup(successMessage, 6000, isDuplicate);

                        if (payload.Mail && payload.Mail !== 'N/A' && payload.Mail.includes('@')) {
                            latestProcessedDataForEmail = {
                                customerEmail: payload.Mail,
                                totalAmount: payload.PrixRemise,
                                quotationId: payload.QuotationId,
                                nomClient: payload.NomClient
                            };
                            showEmailButton(latestProcessedDataForEmail);
                        } else {
                            console.warn(`[${SCRIPT_NAME}] Customer email not available or invalid. Email button will not be shown for Quotation ID: ${payload.QuotationId}`);
                            removeEmailButton();
                        }
                    } else {
                        console.error(`[${SCRIPT_NAME}] Error sending data. Status: ${response.status}. Response:`, respData.message || response.responseText);
                        GM_notification({ title: SCRIPT_NAME + " Error", text: `Sheet Error: ${respData.message || 'Check console.'}`, timeout: 10000 });
                        removeEmailButton();
                    }
                } catch (e) {
                     console.error(`[${SCRIPT_NAME}] Error parsing Google Sheet response. Status: ${response.status}. Response: ${response.responseText}`, e);
                     GM_notification({ title: SCRIPT_NAME + " Error", text: `Sheet response parse error. Check console.`, timeout: 10000 });
                     removeEmailButton();
                }
            },
            onerror: function(response) {
                hideLoadingPopup();
                removeEmailButton();
                console.error(`[${SCRIPT_NAME}] Network error sending data. Status: ${response.status}. Resp:`, response.responseText);
                 GM_notification({ title: SCRIPT_NAME + " Network Error", text: `Network error sending. Check console.`, timeout: 10000 });
            },
            ontimeout: function() {
                hideLoadingPopup();
                removeEmailButton();
                console.error(`[${SCRIPT_NAME}] Timeout sending data to Google Sheet.`);
                 GM_notification({ title: SCRIPT_NAME + " Timeout", text: `Timeout sending data.`, timeout: 10000 });
            }
        });
    }

    function formatDate(isoString) {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        } catch (e) {
            console.error(`[${SCRIPT_NAME}] Error formatting date: ${isoString}`, e);
            return isoString;
        }
    }

    function structureAndSendData(quotationData, customerAttributes, vendeurId, quotationId) {
        try {
            console.log(`[${SCRIPT_NAME}] Structuring combined data (Quotation ID: ${quotationId})...`);
            let allProductNames = [];
            let firstProductIcon = '';
            let totalDiscountPriceSum = 0;

            if (quotationData && Array.isArray(quotationData.categories)) {
                quotationData.categories.forEach(category => {
                    if (category && Array.isArray(category.products)) {
                        category.products.forEach(product => {
                            if (product) {
                                allProductNames.push(product.nameFr || product.nameEn || 'Unknown Product');
                                if (firstProductIcon === '' && product.icon) firstProductIcon = product.icon;
                                totalDiscountPriceSum += (parseFloat(product.totalDiscountPv) || 0);
                            }
                        });
                    }
                });
            } else {
                console.warn(`[${SCRIPT_NAME}] Quotation data or categories array missing/invalid during structuring.`);
            }

            const structuredData = {
                QuotationId: quotationId || '',
                Date: formatDate(quotationData?.creationDate),
                NomClient: customerAttributes ? `${customerAttributes.givenName || ''} ${customerAttributes.familyName || ''}`.trim() : 'N/A',
                Telephone: customerAttributes ? (customerAttributes.mobileNumber || customerAttributes.phoneNumber || '') : '',
                Mail: customerAttributes ? (customerAttributes.email || '') : '',
                NumClient: customerAttributes ? (customerAttributes.customerExternalId || 'N/A') : (quotationData?.customerId || 'N/A'),
                PrixTTC: quotationData?.totalPV ?? null,
                PrixRemise: totalDiscountPriceSum,
                Produits: allProductNames.join(', '),
                Image: firstProductIcon,
                Vendeur: vendeurId || ''
            };
            sendDataToSheet(structuredData);
        } catch(e) {
             console.error(`[${SCRIPT_NAME}] Error during final data structuring or sending (Quotation ID: ${quotationId}):`, e);
             hideLoadingPopup();
             removeEmailButton();
             GM_notification({ title: SCRIPT_NAME + " Error", text: "Error structuring data. Check console.", timeout: 6000 });
        }
    }

    function fetchCustomerDetails(customerId, quotationData, vendeurId, quotationId) {
        if (!latestAuthToken) {
             console.error(`[${SCRIPT_NAME}] Cannot fetch CAFR: Auth token not captured. Quotation ID: ${quotationId}`);
             GM_notification({ title: SCRIPT_NAME + " Auth Error", text: "Auth token missing. Customer details skipped.", timeout: 8000 });
             isProcessingCafr = false;
             structureAndSendData(quotationData, null, vendeurId, quotationId);
             return;
        }

        console.log(`[${SCRIPT_NAME}] Polling fetch for customer: ${customerId} (Quotation ID: ${quotationId})`);
        const fetchUrl = `${CAFR_API_BASE}?filter[customerNumber]=${encodeURIComponent(customerId)}&page[number]=1&page[size]=1`;
        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'X-Tenant': 'CAFR',
            'Authorization': latestAuthToken
        };
        let requestStartTime = Date.now();

        GM_xmlhttpRequest({
            method: "GET",
            url: fetchUrl,
            headers: headers,
            timeout: 30000,
            onload: function(response) {
                let duration = Date.now() - requestStartTime;
                console.log(`[${SCRIPT_NAME}] CAFR fetch onload (poll) after ${duration}ms. Status: ${response.status}. Quotation ID: ${quotationId}`);
                try {
                    if (response.status >= 200 && response.status < 300) {
                        const cafrResponseData = JSON.parse(response.responseText);
                        if (cafrResponseData?.data?.length > 0 && cafrResponseData.data[0].attributes) {
                            console.log(`[${SCRIPT_NAME}] CAFR details found (poll).`, cafrResponseData.data[0].attributes);
                            structureAndSendData(quotationData, cafrResponseData.data[0].attributes, vendeurId, quotationId);
                        } else {
                            console.warn(`[${SCRIPT_NAME}] CAFR data (poll) structure unexpected. Sending partial. Resp:`, cafrResponseData);
                            structureAndSendData(quotationData, null, vendeurId, quotationId);
                        }
                    } else {
                        if (response.status === 401 || response.status === 403) console.error(`[${SCRIPT_NAME}] CAFR Auth Error (${response.status}) (poll). Token might be invalid. Resp:`, response.responseText);
                        else console.error(`[${SCRIPT_NAME}] Error fetching CAFR (poll). Status: ${response.status}. Resp:`, response.responseText);
                        structureAndSendData(quotationData, null, vendeurId, quotationId);
                    }
                } catch (e) {
                    console.error(`[${SCRIPT_NAME}] Error parsing CAFR JSON (poll):`, e, response.responseText);
                    structureAndSendData(quotationData, null, vendeurId, quotationId);
                } finally {
                    isProcessingCafr = false;
                }
            },
            onerror: function(response) {
                console.error(`[${SCRIPT_NAME}] CAFR fetch network error (poll). Status: ${response.status}. Quotation ID: ${quotationId}`, response);
                structureAndSendData(quotationData, null, vendeurId, quotationId);
                isProcessingCafr = false;
             },
            ontimeout: function() {
                console.error(`[${SCRIPT_NAME}] CAFR fetch timeout (poll). Quotation ID: ${quotationId}`);
                structureAndSendData(quotationData, null, vendeurId, quotationId);
                isProcessingCafr = false;
            },
            onabort: function(response) {
                 console.error(`[${SCRIPT_NAME}] CAFR fetch aborted (poll). Quotation ID: ${quotationId}`, response);
                 structureAndSendData(quotationData, null, vendeurId, quotationId);
                 isProcessingCafr = false;
            }
        });
    }

    function processQuotationResponse(quotationData, quotationId) {
        try {
            console.log(`[${SCRIPT_NAME}] Processing Quotation response (ID: ${quotationId})...`);
            const customerIdRaw = quotationData?.customerId;
            const vendeurId = quotationData?.creationUserId;

            if (!quotationData || typeof quotationData !== 'object' || !quotationData.creationDate) {
                 console.error(`[${SCRIPT_NAME}] Invalid Quotation data (ID: ${quotationId}). Aborting.`, quotationData);
                 hideLoadingPopup();
                 removeEmailButton();
                 return;
            }
            if (!quotationId) {
                 console.warn(`[${SCRIPT_NAME}] Quotation ID missing during processing. De-duplication by ID will fail.`, quotationData);
            }

            if (!customerIdRaw) {
                console.warn(`[${SCRIPT_NAME}] Quotation missing 'customerId' (ID: ${quotationId}). Sending partial.`, quotationData);
                structureAndSendData(quotationData, null, vendeurId, quotationId);
                return;
            }
            if (!vendeurId) {
                 console.warn(`[${SCRIPT_NAME}] Quotation missing 'creationUserId' (ID: ${quotationId}). Vendeur empty.`, quotationData);
            }

            const customerIdClean = customerIdRaw.replace(/^SQ_/, '');
            const dataToStore = { customerIdClean, quotationData: JSON.parse(JSON.stringify(quotationData)), vendeurId, quotationId };

            if (!isProcessingCafr) {
                 console.log(`[${SCRIPT_NAME}] Storing data for CAFR poll: CustID ${customerIdClean}, QuotID ${quotationId}`);
                 pendingCafrData = dataToStore;
            } else {
                 console.warn(`[${SCRIPT_NAME}] Overwriting pending CAFR data due to new Quotation (ID: ${quotationId}) while previous was processing.`);
                 pendingCafrData = dataToStore;
            }
            console.log(`[${SCRIPT_NAME}] processQuotationResponse finished for Quotation ID: ${quotationId}.`);

        } catch (e) {
            console.error(`[${SCRIPT_NAME}] Error processing quotation data (ID: ${quotationId}):`, e, quotationData);
            hideLoadingPopup();
            removeEmailButton();
        }
    }

    function checkAndProcessPendingCafr() {
        if (pendingCafrData && !isProcessingCafr) {
            console.log(`[${SCRIPT_NAME}] Poller found pending data. Initiating CAFR fetch for Quotation ID: ${pendingCafrData.quotationId}.`);
            isProcessingCafr = true;

            const dataToProcess = pendingCafrData;
            pendingCafrData = null;

            try {
                 fetchCustomerDetails(dataToProcess.customerIdClean, dataToProcess.quotationData, dataToProcess.vendeurId, dataToProcess.quotationId);
            } catch(e) {
                 console.error(`[${SCRIPT_NAME}] Sync error calling fetchCustomerDetails from poller (QuotID: ${dataToProcess.quotationId}):`, e);
                 isProcessingCafr = false;
                 if(dataToProcess && dataToProcess.quotationData) {
                     structureAndSendData(dataToProcess.quotationData, null, dataToProcess.vendeurId, dataToProcess.quotationId);
                 } else {
                     hideLoadingPopup();
                     removeEmailButton();
                 }
            }
        }
    }

    function getTargetMatch(url) {
        if (!url || typeof url !== 'string') return null;
        for (const target of TARGETS) {
            if (url.includes(target.url_pattern)) {
                return target;
            }
        }
        return null;
    }

    function extractQuotationId(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('id');
        } catch (e) {
            const match = url.match(/[?&]id=([^&]+)/);
            if (match && match[1]) {
                return match[1];
            }
            console.warn(`[${SCRIPT_NAME}] Could not extract quotation ID from URL: ${url}`, e);
            return null;
        }
    }

    async function parseAndProcessQuotationResponse(response, quotationId) {
        const url = response.url || (response.responseURL);
        console.log(`[${SCRIPT_NAME}] Intercepted ${response.ok ? 'OK' : 'Failed'} Quotation response (ID: ${quotationId}) from: ${url}`);
        if (!response.ok) {
             console.warn(`[${SCRIPT_NAME}] Ignoring failed Quotation request (${response.status}) (ID: ${quotationId}).`);
             return;
        }

        showLoadingPopup("Envoi du devis en cours...");

        try {
            const responseClone = response.clone();
            const text = await responseClone.text();
            if (!text || text.trim() === '') {
                 console.warn(`[${SCRIPT_NAME}] Quotation Response (ID: ${quotationId}, URL: ${url}) body is empty.`);
                 hideLoadingPopup();
                 return;
            }
            const jsonData = JSON.parse(text);
            processQuotationResponse(jsonData, quotationId);
        } catch (err) {
             hideLoadingPopup();
             const errorText = await response.clone().text().catch(() => "Could not get error text");
             if (err instanceof SyntaxError) {
                 console.error(`[${SCRIPT_NAME}] Quotation Response (ID: ${quotationId}, URL: ${url}) not valid JSON. Snippet:`, errorText.substring(0, 200), err);
             } else {
                 console.error(`[${SCRIPT_NAME}] Error reading Quotation Response body (ID: ${quotationId}, URL: ${url}):`, err, errorText.substring(0,200));
             }
        }
    }

    const originalFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = function(input, init) {
        const url = (typeof input === 'string') ? input : input.url;
        const target = getTargetMatch(url);
        let currentQuotationId = null;

        if (target && target.name === API_TYPES.CAFR) {
            if (init && init.headers) {
                const headers = new Headers(init.headers);
                const token = headers.get('Authorization');
                if (token && token.toLowerCase().startsWith('bearer ')) {
                    if (latestAuthToken !== token) {
                        console.log(`[${SCRIPT_NAME}] Captured/Updated Auth Token via fetch for CAFR.`);
                        latestAuthToken = token;
                    }
                } else if (token) {
                    console.warn(`[${SCRIPT_NAME}] Non-Bearer Authorization header found for CAFR (fetch): ${token.substring(0,10)}...`);
                }
            }
        } else if (target && target.name === API_TYPES.QUOTATION) {
            currentQuotationId = extractQuotationId(url);
            console.log(`[${SCRIPT_NAME}] Fetch: ${target.name} (ID: ${currentQuotationId || 'N/A'}): ${url.substring(0,100)}...`);
        }

        const promise = originalFetch.apply(this, arguments);

        if (target && target.name === API_TYPES.QUOTATION) {
            promise.then(response => {
                 const responseClone = response.clone();
                 (async () => { await parseAndProcessQuotationResponse(responseClone, currentQuotationId); })();
                 return response;
            }).catch(error => {
                console.error(`[${SCRIPT_NAME}] Network/Fetch Error intercepting ${target.name} (ID: ${currentQuotationId}, URL: ${url}):`, error);
            });
        }
        return promise;
    };

    const originalXhrOpen = unsafeWindow.XMLHttpRequest.prototype.open;
    const originalXhrSend = unsafeWindow.XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = unsafeWindow.XMLHttpRequest.prototype.setRequestHeader;

    unsafeWindow.XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (this._target && this._target.name === API_TYPES.CAFR && header.toLowerCase() === 'authorization') {
             if (value && value.toLowerCase().startsWith('bearer ')) {
                if (latestAuthToken !== value) {
                    console.log(`[${SCRIPT_NAME}] Captured/Updated Auth Token via XHR for CAFR.`);
                    latestAuthToken = value;
                }
             } else if (value) {
                console.warn(`[${SCRIPT_NAME}] Non-Bearer Authorization header found for CAFR (XHR): ${value.substring(0,10)}...`);
             }
        }
        originalSetRequestHeader.apply(this, arguments);
    };

    unsafeWindow.XMLHttpRequest.prototype.open = function(method, url) {
        this._requestURL = url;
        this._target = getTargetMatch(url);
        this._quotationId = null;

        if (this._target) {
             if (this._target.name === API_TYPES.QUOTATION) {
                this._quotationId = extractQuotationId(url);
                console.log(`[${SCRIPT_NAME}] XHR Open: ${this._target.name} (ID: ${this._quotationId || 'N/A'}): ${url.substring(0,100)}...`);
            }
        }
        originalXhrOpen.apply(this, arguments);
    };

    unsafeWindow.XMLHttpRequest.prototype.send = function() {
        const xhr = this;
        if (xhr._target && xhr._target.name === API_TYPES.QUOTATION && !xhr._hasScraperListener) {
             const originalOnReadyStateChange = xhr.onreadystatechange;
             xhr._hasScraperListener = true;

             xhr.onreadystatechange = function() {
                if (xhr.readyState === 4 && xhr._target && xhr._target.name === API_TYPES.QUOTATION) {
                     const simulatedResponse = {
                        ok: xhr.status >= 200 && xhr.status < 300,
                        status: xhr.status,
                        statusText: xhr.statusText,
                        url: xhr.responseURL || xhr._requestURL,
                        text: async () => xhr.responseText,
                        clone: function() { return { ...this, text: async () => xhr.responseText }; }
                     };
                     (async () => {
                         try { await parseAndProcessQuotationResponse(simulatedResponse, xhr._quotationId); }
                         catch(e) { console.error(`[${SCRIPT_NAME}] Error in XHR onreadystatechange for Quotation (ID: ${xhr._quotationId}):`, e); }
                     })();
                }
                if (originalOnReadyStateChange) {
                     originalOnReadyStateChange.apply(xhr, arguments);
                }
            };
        }
        originalXhrSend.apply(this, arguments);
    };

    console.log(`[${SCRIPT_NAME}] v${GM_info.script.version} loaded. Monitoring Quotation & CAFR. Email feature included.`);
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes('PASTE_YOUR')) {
        GM_notification({ title: SCRIPT_NAME + " WARNING", text: `v${GM_info.script.version}: Google Script URL missing!`, timeout: 10000 });
    } else if (STORE_PHONE.includes("XX XX XX XX")) {
        GM_notification({ title: SCRIPT_NAME + " WARNING", text: `v${GM_info.script.version}: Store phone number needs configuration for email template!`, timeout: 10000 });
    }
     else {
         console.log(`[${SCRIPT_NAME}] Ready. Google Script URL and Store Phone are set.`);
    }

    pollingIntervalId = setInterval(checkAndProcessPendingCafr, POLLING_INTERVAL_MS);
    console.log(`[${SCRIPT_NAME}] Polling started (Interval: ${POLLING_INTERVAL_MS}ms).`);

})();