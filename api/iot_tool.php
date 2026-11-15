<?php
// api/iot_tool.php
// Dispositivi nei flow, canale MQTT (_doc/arch-iot-dispositivi.md §8, passo 5a).
// Client: app/FLE_sub_modules/FLE-device-client.mjs (mqttBrokers, connessione ai broker).
//
// GET ?action=brokers           → [{id, title, prefix}] dei broker che l'utente può usare
// GET ?action=connect&broker=id → {title, url, username, password, prefix} per collegare il browser
//
// I broker sono in cfg/cfg_iot.php (modello: cfg/cfg_iot.example.php): il flow conosce solo l'id,
// mai l'indirizzo (§9). Le credenziali del browser sono, per ora, un account CONDIVISO per broker
// (§8.3): arrivano a chiunque sia autenticato (agli ospiti solo se il broker ha guests = true).
// Il passo 7 (token brevi per utente verificati dal broker) le sostituirà.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest

function iot_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function iot_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) iot_err('Utente non autenticato.', 401);
$guest = ra_is_guest($user);

/** Broker validi di cfg/cfg_iot.php che questo utente può usare: id → configurazione. */
function iot_brokers(bool $guest): array {
  $file = __DIR__ . '/../cfg/cfg_iot.php';
  if (!is_file($file)) return [];
  $cfg = require $file;
  $out = [];
  foreach (($cfg['brokers'] ?? []) as $id => $b) {
    if (!is_array($b) || !preg_match('/^[A-Za-z0-9_-]{1,32}$/', (string)$id)) continue;
    $url    = (string)($b['url'] ?? '');
    $prefix = trim((string)($b['prefix'] ?? 'ra'), '/');
    if (!preg_match('#^wss://#i', $url)) continue;                       // pagina in https: solo wss
    if (!preg_match('#^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$#', $prefix)) continue;   // niente + # $ nella radice
    if ($guest && empty($b['guests'])) continue;
    $out[(string)$id] = [
      'title'    => (string)($b['title'] ?? $id),
      'url'      => $url,
      'username' => (string)($b['username'] ?? ''),
      'password' => (string)($b['password'] ?? ''),
      'prefix'   => $prefix,
    ];
  }
  return $out;
}

$action  = (string)($_GET['action'] ?? '');
$brokers = iot_brokers($guest);

if ($action === 'brokers') {
  $list = [];
  foreach ($brokers as $id => $b) $list[] = ['id' => $id, 'title' => $b['title'], 'prefix' => $b['prefix']];
  iot_ok($list);
}

if ($action === 'connect') {
  $id = (string)($_GET['broker'] ?? '');
  if (!isset($brokers[$id])) iot_err("Broker \"$id\" non configurato o non disponibile.", 404);
  iot_ok($brokers[$id]);
}

iot_err('Azione non valida.');
