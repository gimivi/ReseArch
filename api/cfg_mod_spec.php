<?php
// api/cfg_mod_spec.php
// Restituisce i template mod_spec per il picker del sub-modale "Spec (JSON)"
// (ui/modal_models.js). Dal 2026-09-28 legge dalla tabella mod_spec_templates
// (prima: file statico cfg/cfg_mod_spec.php, eliminato — step 1 di
// _doc/arch-abilitazioni.md).
//
// Filtro: solo template attivi delle APP che l'utente può creare (stessa
// regola della whitelist obj_app, api/app_catalog.php), più i 'CUS' (Custom,
// validi per qualunque APP) sempre per primi. Il livello 'advanced' arriva
// solo a chi ce l'ha in un profilo (step 2; il profilo "Base" iniziale lo
// dà a tutti); il picker poi lo nasconde finché non si attiva "mostra
// avanzati". I template non hanno contenuto attivo — questo filtro serve a
// semplificare l'interfaccia, non è un controllo di sicurezza.
//
// Formato (retrocompatibile con il vecchio file): array di
// { tpl_id, type, app_title, name, level, help, spec }.

declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/app_catalog.php';

function tpl_err(string $msg, int $code): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

$user = $_SESSION['user'] ?? null;
if (!is_array($user)) tpl_err('Utente non autenticato.', 401);

try {
  $caps    = user_caps($pdo, $user);
  $catalog = app_catalog($pdo, $caps);

  $rows = $pdo->query("SELECT tpl_id, app_cod, tpl_name, tpl_level, tpl_help, tpl_spec, tpl_sort
                       FROM mod_spec_templates
                       WHERE is_active = 1")->fetchAll(PDO::FETCH_ASSOC);

  $out = [];
  foreach ($rows as $r) {
    $cod = app_norm_cod($r['app_cod']);
    $isCustom = $cod === 'CUS';
    if (!$isCustom && empty($catalog[$cod]['creatable'])) continue;
    if (!user_sees_template_level($caps, (string)$r['tpl_level'])) continue;

    $out[] = [
      'tpl_id'    => (int)$r['tpl_id'],
      'type'      => $cod,
      'app_title' => $isCustom ? 'Custom' : $catalog[$cod]['title'],
      'name'      => (string)$r['tpl_name'],
      'level'     => (string)$r['tpl_level'],
      'help'      => (string)$r['tpl_help'],
      'spec'      => json_decode((string)$r['tpl_spec']),
      '_order'    => [$isCustom ? -1 : $catalog[$cod]['sort'], $cod, (int)$r['tpl_sort'], (string)$r['tpl_name']],
    ];
  }

  // Custom per primo (il picker usa il primo template come default dei
  // modelli nuovi), poi per ordine APP, ordine template, nome.
  usort($out, fn($a, $b) => $a['_order'] <=> $b['_order']);
  foreach ($out as &$t) unset($t['_order']);
  unset($t);

  echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
  tpl_err('Errore lettura template: ' . $e->getMessage(), 500);
}
