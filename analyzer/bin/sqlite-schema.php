#!/usr/bin/env php
<?php
if ($argc < 2) {
  echo json_encode(['dbPath' => '', 'tables' => [], 'error' => 'No path provided']);
  exit(1);
}

$dbPath = realpath($argv[1]);
if (!$dbPath || !file_exists($dbPath)) {
  echo json_encode(['dbPath' => $argv[1], 'tables' => [], 'error' => 'File not found']);
  exit(1);
}

try {
  $db = new SQLite3($dbPath, SQLITE3_OPEN_READONLY);
  $result = ['dbPath' => $dbPath, 'tables' => []];

  $tableRes = $db->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  while ($row = $tableRes->fetchArray(SQLITE3_ASSOC)) {
    $tbl = $row['name'];
    $columns = [];
    $colRes = $db->query("PRAGMA table_info(\"$tbl\")");
    while ($col = $colRes->fetchArray(SQLITE3_ASSOC)) {
      $columns[] = [
        'name' => $col['name'],
        'type' => $col['type'],
        'nullable' => $col['notnull'] === 0,
        'pk' => $col['pk'] === 1,
        'defaultValue' => $col['dflt_value'],
      ];
    }
    $result['tables'][] = ['name' => $tbl, 'columns' => $columns];
  }

  $db->close();
  echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
} catch (Throwable $e) {
  echo json_encode(['dbPath' => $dbPath, 'tables' => [], 'error' => $e->getMessage()]);
  exit(1);
}
