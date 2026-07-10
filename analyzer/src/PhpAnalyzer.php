<?php

namespace ProjectManager\Analyzer;

use PhpParser\Error;
use PhpParser\Node;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitorAbstract;
use PhpParser\ParserFactory;
use PhpParser\PhpVersion;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use FilesystemIterator;

class PhpAnalyzer
{
    private string $projectPath;
    private array $files = [];
    private array $globalDependencies = [];
    private array $globalDbReferences = [];
    private array $namespaceMap = [];
    private array $classMap = [];
    private int $progressInterval = 100;
    private int $nextProgress = 100;
    private int $fileCount = 0;

    private const SKIP_DIRS = [
        'vendor', 'node_modules', '.git', '.svn', '.hg',
        'storage/framework', 'storage/logs', 'storage/debugbar',
        'bootstrap/cache', 'runtime', 'dist', '.portable-build',
    ];

    public function __construct(string $projectPath)
    {
        $this->projectPath = rtrim($projectPath, '/\\');
    }

    public function analyze(): array
    {
        $phpFiles = $this->findPhpFiles();
        $this->fileCount = count($phpFiles);

        fwrite(STDERR, "PROGRESS:0\n");

        foreach ($phpFiles as $i => $filePath) {
            try {
                $fileInfo = $this->analyzeFile($filePath);
                if ($fileInfo !== null) {
                    $this->files[] = $fileInfo;
                }
            } catch (Throwable $e) {
                $this->files[] = [
                    'path' => $filePath,
                    'relativePath' => $this->getRelativePath($filePath),
                    'size' => file_exists($filePath) ? filesize($filePath) : 0,
                    'lines' => 0,
                    'isDir' => false,
                    'classes' => [],
                    'traits' => [],
                    'interfaces' => [],
                    'functions' => [],
                    'dependencies' => [],
                    'dbReferences' => [],
                    'flowGraph' => null,
                    'error' => $e->getMessage() . ':' . $e->getLine(),
                ];
            }

            $done = $i + 1;
            if ($done >= $this->nextProgress) {
                $pct = min(95, (int)($done / $this->fileCount * 100));
                fwrite(STDERR, "PROGRESS:$pct\n");
                $this->nextProgress = $done + $this->progressInterval;
            }
        }

        fwrite(STDERR, "PROGRESS:96\n");
        $this->resolveDependencies();
        fwrite(STDERR, "PROGRESS:100\n");

        return $this->buildResult();
    }

    private function findPhpFiles(): array
    {
        $files = [];
        $directory = new RecursiveDirectoryIterator(
            $this->projectPath,
            FilesystemIterator::SKIP_DOTS
        );
        $iterator = new RecursiveIteratorIterator($directory);

        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $realPath = $file->getRealPath();
                if ($realPath === false) continue;
                $relPath = str_replace($this->projectPath . '/', '', $realPath);
                $skip = false;
                foreach (self::SKIP_DIRS as $skipDir) {
                    if (str_starts_with($relPath, $skipDir . '/') || str_starts_with($relPath, $skipDir . '\\')) {
                        $skip = true;
                        break;
                    }
                }
                if (!$skip) {
                    $files[] = $realPath;
                }
            }
        }

        sort($files);
        return $files;
    }

    private function analyzeFile(string $filePath): ?array
    {
        $code = @file_get_contents($filePath);
        if ($code === false) return null;

        $relativePath = $this->getRelativePath($filePath);
        $lines = substr_count($code, "\n") + 1;
        $size = filesize($filePath);

        $parser = (new ParserFactory())->createForVersion(PhpVersion::fromString('8.0'));

        try {
            $ast = $parser->parse($code);
        } catch (Error) {
            return [
                'path' => $filePath,
                'relativePath' => $relativePath,
                'size' => $size,
                'lines' => $lines,
                'isDir' => false,
                'classes' => [],
                'traits' => [],
                'interfaces' => [],
                'functions' => [],
                'dependencies' => $this->findDependenciesRegex($code, $relativePath),
                'dbReferences' => $this->findDbReferencesRegex($code),
                'flowGraph' => null,
            ];
        }

        if ($ast === null) return null;

        $context = new AnalysisContext($relativePath);

        $traverser = new NodeTraverser();
        $visitor = new FileAnalysisVisitor($context);
        $traverser->addVisitor($visitor);

        $traverser->traverse($ast);

        // Build class map from the same AST (no second parse)
        $namespace = '';
        $this->walkForClassMap($ast, $relativePath, $namespace);

        $regexDeps = $this->findDependenciesRegex($code, $relativePath);
        $regexDbRefs = $this->findDbReferencesRegex($code);

        $allDeps = array_merge($context->dependencies, $regexDeps);
        $allDbRefs = array_merge($context->dbReferences, $regexDbRefs);

        $allDbRefs = $this->deduplicateDbRefs($allDbRefs);
        $allDbRefs = array_values(array_filter($allDbRefs, fn($r) => self::isLikelyTableName($r['table'])));
        $allDeps = $this->deduplicateDeps($allDeps);

        $this->globalDependencies = array_merge($this->globalDependencies, $allDeps);
        $this->globalDbReferences = array_merge($this->globalDbReferences, $allDbRefs);

        $flowGraph = $ast ? $this->extractFlowGraph($ast) : null;

        return [
            'path' => $filePath,
            'relativePath' => $relativePath,
            'size' => $size,
            'lines' => $lines,
            'isDir' => false,
            'classes' => $context->classes,
            'traits' => $context->traits,
            'interfaces' => $context->interfaces,
            'functions' => $context->functions,
            'dependencies' => $allDeps,
            'dbReferences' => $allDbRefs,
            'flowGraph' => $flowGraph,
        ];
    }

    private function walkForClassMap(array $nodes, string $relativePath, string &$namespace): void
    {
        foreach ($nodes as $node) {
            if ($node instanceof Node\Stmt\Namespace_) {
                $oldNamespace = $namespace;
                $namespace = $node->name ? implode('\\', $node->name->getParts()) : '';
                if ($node->stmts) {
                    $this->walkForClassMap($node->stmts, $relativePath, $namespace);
                }
                $namespace = $oldNamespace;
                continue;
            }
            if ($node instanceof Node\Stmt\Class_ && $node->name) {
                $className = $node->name->name;
                $fullName = $namespace ? $namespace . '\\' . $className : $className;
                $this->classMap[$fullName] = $relativePath;
                if ($node->extends) {
                    $parentName = $node->extends->getAttribute('originalName');
                    if ($parentName) {
                        $parentStr = $parentName instanceof Node\Name ? implode('\\', $parentName->getParts()) : (string)$parentName;
                        $fullParent = $namespace ? $namespace . '\\' . $parentStr : $parentStr;
                        $this->classMap[$fullParent] = $this->classMap[$fullParent] ?? $relativePath;
                    }
                }
                continue;
            }
            if (property_exists($node, 'stmts') && $node->stmts) {
                $this->walkForClassMap($node->stmts, $relativePath, $namespace);
            }
        }
    }

    private function findDependenciesRegex(string $code, string $relativePath): array
    {
        $deps = [];

        $patterns = [
            '/include\s+(__DIR__\s*\.\s*)?[\'"]([^\'"]+)[\'"]\s*;/',
            '/include_once\s+(__DIR__\s*\.\s*)?[\'"]([^\'"]+)[\'"]\s*;/',
            '/require\s+(__DIR__\s*\.\s*)?[\'"]([^\'"]+)[\'"]\s*;/',
            '/require_once\s+(__DIR__\s*\.\s*)?[\'"]([^\'"]+)[\'"]\s*;/',
        ];

        foreach ($patterns as $pattern) {
            $type = 'include';
            if (str_contains($pattern, 'require')) {
                $type = 'require';
            }
            if (preg_match_all($pattern, $code, $matches, PREG_SET_ORDER)) {
                foreach ($matches as $match) {
                    $target = end($match);
                    $deps[] = [
                        'type' => $type,
                        'target' => $target,
                        'resolvedPath' => null,
                        'line' => 0,
                    ];
                }
            }
        }

        return $deps;
    }

    private function findDbReferencesRegex(string $code): array
    {
        $refs = [];

        // Raw SQL in strings: only count if preceded by DB context
        $sqlContextPatterns = [
            'SELECT' => '/\bSELECT\b.+?\bFROM\b\s+[`\'"]?([a-zA-Z_]\w*)[`\'"]?/si',
            'INSERT' => '/\bINSERT\s+INTO\b\s+[`\'"]?([a-zA-Z_]\w*)[`\'"]?/si',
            'UPDATE' => '/\bUPDATE\b\s+[`\'"]?([a-zA-Z_]\w*)[`\'"]?/si',
            'DELETE' => '/\bDELETE\b.+?\bFROM\b\s+[`\'"]?([a-zA-Z_]\w*)[`\'"]?/si',
        ];

        // ORM/Database patterns – more specific
        $dbPatterns = [
            'DB_TABLE' => '/\b(?:DB|db)\s*::\s*table\s*\(\s*[\'"]([a-zA-Z_]\w*)[\'"]\s*\)/si',
            'SCHEMA_TABLE' => '/\bSchema\s*::\s*(?:create|table|drop|hasTable|rename|hasColumn)\s*\(\s*[\'"]([a-zA-Z_]\w*)[\'"]\s*\)/si',
            'CHAIN_FROM' => '/->\s*(?:table|from)\s*\(\s*[\'"]([a-zA-Z_]\w*)[\'"]\s*\)/si',
            'JOIN' => '/->\s*join(?:Left|Right|Inner|Outer)?\s*\(\s*[\'"]([a-zA-Z_]\w*)[\'"]\s*[,\)]/si',
            'MODEL_QUERY' => '/([A-Z][a-zA-Z0-9_]+)::\s*(?:find|findOrFail|firstOrCreate|updateOrCreate|firstWhere|withCount|doesntHave|paginate|simplePaginate|where|all|create|first)\s*\(/',
        ];

        // SQLite patterns
        $sqlitePatterns = [
            'SQLITE_OPEN' => '/\b(?:new\s+SQLite3|sqlite_open|SQLite3\s*\()/si',
            'SQLITE_ATTACH' => '/ATTACH\s+DATABASE\s+[`\'"]?([^`\'"]+)[`\'"]?\s+AS\s+[`\'"]?([^`\'"]+)[`\'"]?/si',
        ];

        $lines = explode("\n", $code);
        foreach ($lines as $lineNum => $line) {
            // Raw SQL patterns – require DB context on the line
            $hasDbContext = preg_match('/\b(?:query|prepare|execute|fetch|pdo|sql|raw|statement)\s*[=:;(]/si', $line)
                || str_contains($line, '->')
                || str_contains($line, '::');

            foreach ($sqlContextPatterns as $operation => $pattern) {
                if ($hasDbContext && preg_match($pattern, $line, $matches)) {
                    $table = $matches[1];
                    if ($this->isLikelyTableName($table)) {
                        $refs[] = [
                            'table' => $table,
                            'operation' => $operation,
                            'context' => trim(substr($line, 0, 120)),
                            'line' => $lineNum + 1,
                        ];
                    }
                }
            }

            // Database patterns
            foreach ($dbPatterns as $operation => $pattern) {
                if (preg_match_all($pattern, $line, $matches, PREG_SET_ORDER)) {
                    foreach ($matches as $match) {
                        $table = $match[1];
                        if ($this->isLikelyTableName($table)) {
                            $refs[] = [
                                'table' => $table,
                                'operation' => $operation,
                                'context' => trim(substr($line, 0, 120)),
                                'line' => $lineNum + 1,
                            ];
                        }
                    }
                }
            }

            // SQLite patterns
            if (preg_match($sqlitePatterns['SQLITE_OPEN'], $line, $matches)) {
                $refs[] = [
                    'table' => 'sqlite',
                    'operation' => 'SQLITE',
                    'context' => trim(substr($line, 0, 120)),
                    'line' => $lineNum + 1,
                ];
            }
            if (preg_match($sqlitePatterns['SQLITE_ATTACH'], $line, $matches)) {
                $dbName = $matches[2] ?? 'attached';
                $refs[] = [
                    'table' => $dbName,
                    'operation' => 'SQLITE',
                    'context' => trim(substr($line, 0, 120)),
                    'line' => $lineNum + 1,
                ];
            }
        }

        return $refs;
    }

    /**
     * Filter out common column/variable names that are not table names.
     */
    public static function isLikelyTableName(string $name): bool
    {
        if (strlen($name) < 2) return false;

        $nonTables = [
            'id', 'uuid',
            'name', 'title', 'slug', 'code', 'type', 'status',
            'email', 'password', 'hash',
            'phone', 'mobile', 'fax',
            'address', 'city', 'state', 'zip', 'postal_code', 'country',
            'first_name', 'last_name', 'full_name',
            'url', 'link', 'path', 'file', 'files', 'image', 'images', 'photo',
            'price', 'cost', 'total', 'subtotal', 'tax', 'discount', 'vat',
            'quantity', 'qty', 'amount',
            'notes', 'description', 'content', 'body', 'summary', 'excerpt',
            'active', 'is_active', 'enabled', 'disabled', 'visible', 'hidden',
            'sort', 'order', 'position', 'priority',
            'created_at', 'updated_at', 'deleted_at',
            'created_by', 'updated_by', 'deleted_by',
            'date', 'start_date', 'end_date', 'due_date', 'created_date',
            'time', 'start_time', 'end_time',
            'token', 'api_token', 'remember_token',
            'key', 'value', 'data', 'meta', 'json', 'jsonb',
            'min', 'max', 'avg', 'sum', 'count',
            'width', 'height', 'length', 'size', 'weight', 'color',
            'limit', 'offset', 'page', 'per_page', 'paginate',
            'from', 'to', 'subject', 'message', 'body',
            'ip', 'ip_address', 'user_agent', 'session', 'referer', 'referrer',
            'lang', 'locale', 'currency', 'timezone', 'locale',
            'default', 'extra', 'other', 'none', 'all',
            'config', 'configuration', 'setting', 'settings',
            'row', 'rows', 'col', 'cols', 'column', 'columns',
            'table', 'tables', 'field', 'fields',
            'class', 'classes', 'method', 'methods',
            'group', 'groups', 'category', 'categories',
            'about', 'after', 'error', 'failed', 'list', 'request', 'completed',
            'sqlite_master', 'sqlite_sequence', 'pragma_table_info',
        ];

        if (in_array(strtolower($name), $nonTables, true)) return false;

        // SQL reserved words
        $sqlKeywords = ['select','insert','update','delete','from','where','into','values','set',
            'table','create','alter','drop','index','key','primary','foreign','unique',
            'constraint','default','null','not','and','or','in','like','between','exists',
            'having','group','order','by','asc','desc','limit','offset','join','left',
            'right','inner','outer','on','as','union','all','distinct','count','sum',
            'avg','min','max','true','false'];
        if (in_array(strtolower($name), $sqlKeywords, true)) return false;

        return true;
    }

    private function deduplicateDbRefs(array $refs): array
    {
        $seen = [];
        $unique = [];
        foreach ($refs as $ref) {
            $key = $ref['table'] . '|' . $ref['operation'] . '|' . $ref['line'];
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $unique[] = $ref;
            }
        }
        return $unique;
    }

    private function deduplicateDeps(array $deps): array
    {
        $seen = [];
        $unique = [];
        foreach ($deps as $dep) {
            $key = $dep['type'] . '|' . $dep['target'] . '|' . $dep['line'];
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $unique[] = $dep;
            }
        }
        return $unique;
    }

    private function resolveDependencies(): void
    {
        foreach ($this->files as &$file) {
            foreach ($file['dependencies'] as &$dep) {
                if ($dep['type'] === 'use') {
                    $className = ltrim($dep['target'], '\\');
                    $className = is_object($className) ? (string)$className : $className;
                    if (isset($this->classMap[$className])) {
                        $dep['resolvedPath'] = $this->classMap[$className];
                    } else {
                        $parts = explode('\\', $className);
                        $shortName = end($parts);
                        foreach ($this->classMap as $fullClass => $path) {
                            if (str_ends_with($fullClass, '\\' . $shortName)) {
                                $dep['resolvedPath'] = $path;
                                break;
                            }
                        }
                    }
                } elseif (in_array($dep['type'], ['include', 'require'])) {
                    $target = $dep['target'];
                    $baseDir = dirname($file['path']);
                    $possiblePaths = [
                        $baseDir . '/' . $target,
                        dirname($this->projectPath) . '/' . $target,
                        $this->projectPath . '/' . ltrim($target, '/'),
                    ];
                    foreach ($possiblePaths as $pp) {
                        $real = @realpath($pp);
                        if ($real !== false && file_exists($real)) {
                            $dep['resolvedPath'] = $this->getRelativePath($real);
                            break;
                        }
                    }
                }
            }
            unset($dep);
        }
        unset($file);
    }

    private function buildResult(): array
    {
        $totalFiles = 0;
        $totalLines = 0;
        $totalClasses = 0;
        $totalDirs = 0;

        foreach ($this->files as $file) {
            $totalFiles++;
            $totalLines += $file['lines'];
            $totalClasses += count($file['classes']);
        }

        $totalDep = count($this->globalDependencies);
        $totalDb = count($this->globalDbReferences);

        return [
            'projectPath' => $this->projectPath,
            'projectName' => basename($this->projectPath),
            'analyzedAt' => date('c'),
            'summary' => [
                'totalFiles' => $totalFiles,
                'totalDirs' => $totalDirs,
                'totalLines' => $totalLines,
                'totalClasses' => $totalClasses,
                'totalDependencies' => $totalDep,
                'totalDbReferences' => $totalDb,
            ],
            'files' => $this->files,
        ];
    }

    private function getRelativePath(string $filePath): string
    {
        return str_replace($this->projectPath . '/', '', $filePath);
    }

    private function extractFlowGraph(array $stmts): array
    {
        $nodes = [];
        $edges = [];
        $nextId = 0;

        $nodes[] = ['id' => $nextId, 'type' => 'entry', 'label' => 'Entry', 'line' => 1];
        $entryId = $nextId++;

        $this->walkStmts($stmts, $nodes, $edges, $nextId, $entryId);

        return ['nodes' => $nodes, 'edges' => $edges];
    }

    private function walkStmts(array $stmts, array &$nodes, array &$edges, int &$nextId, int $prevId): int
    {
        $lastId = $prevId;
        foreach ($stmts as $stmt) {
            $result = $this->walkStmt($stmt, $nodes, $edges, $nextId);
            if ($result !== null) {
                $edges[] = ['source' => $lastId, 'target' => $result[0], 'label' => ''];
                $lastId = $result[1];
            }
        }
        return $lastId;
    }

    private function walkStmt(Node $stmt, array &$nodes, array &$edges, int &$nextId): ?array
    {
        if ($stmt instanceof Node\Stmt\Function_) {
            $name = $stmt->name->name ?? 'anonymous';
            $params = [];
            foreach ($stmt->params as $p) {
                $params[] = $p->var->name ?? '...';
            }
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'function', 'label' => "$name(" . implode(', ', $params) . ")", 'line' => $stmt->getLine()];
            $last = $this->walkStmts($stmt->stmts, $nodes, $edges, $nextId, $id);
            return [$id, $last];
        }

        if ($stmt instanceof Node\Stmt\ClassMethod) {
            $name = $stmt->name->name ?? 'anonymous';
            $params = [];
            foreach ($stmt->params as $p) {
                $params[] = $p->var->name ?? '...';
            }
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'method', 'label' => "$name(" . implode(', ', $params) . ")", 'line' => $stmt->getLine()];
            $last = $this->walkStmts($stmt->stmts ?? [], $nodes, $edges, $nextId, $id);
            return [$id, $last];
        }

        if ($stmt instanceof Node\Stmt\If_) {
            $condStr = $this->exprToString($stmt->cond);
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'if', 'label' => "if ($condStr)", 'line' => $stmt->getLine()];

            $bodyLast = $this->walkStmts($stmt->stmts, $nodes, $edges, $nextId, $id);

            $exitId = $bodyLast;
            $prevIf = $id;

            foreach ($stmt->elseifs as $elseif) {
                $ec = $this->exprToString($elseif->cond);
                $eid = $nextId++;
                $nodes[] = ['id' => $eid, 'type' => 'elseif', 'label' => "elseif ($ec)", 'line' => $elseif->getLine()];
                $edges[] = ['source' => $prevIf, 'target' => $eid, 'label' => 'false'];
                $eLast = $this->walkStmts($elseif->stmts, $nodes, $edges, $nextId, $eid);
                $exitId = $eLast;
                $prevIf = $eid;
            }

            if ($stmt->else) {
                $eid = $nextId++;
                $nodes[] = ['id' => $eid, 'type' => 'else', 'label' => 'else', 'line' => $stmt->else->getLine()];
                $edges[] = ['source' => $prevIf, 'target' => $eid, 'label' => 'false'];
                $eLast = $this->walkStmts($stmt->else->stmts, $nodes, $edges, $nextId, $eid);
                $exitId = $eLast;
            }

            return [$id, $exitId];
        }

        if ($stmt instanceof Node\Stmt\Foreach_) {
            $vStr = $this->exprToString($stmt->expr);
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'foreach', 'label' => "foreach ($vStr)", 'line' => $stmt->getLine()];
            $bodyLast = $this->walkStmts($stmt->stmts, $nodes, $edges, $nextId, $id);
            return [$id, $bodyLast];
        }

        if ($stmt instanceof Node\Stmt\For_) {
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'for', 'label' => 'for (...)', 'line' => $stmt->getLine()];
            $bodyLast = $this->walkStmts($stmt->stmts, $nodes, $edges, $nextId, $id);
            return [$id, $bodyLast];
        }

        if ($stmt instanceof Node\Stmt\While_) {
            $cStr = $this->exprToString($stmt->cond);
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'while', 'label' => "while ($cStr)", 'line' => $stmt->getLine()];
            $bodyLast = $this->walkStmts($stmt->stmts, $nodes, $edges, $nextId, $id);
            return [$id, $bodyLast];
        }

        if ($stmt instanceof Node\Stmt\Do_) {
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'dowhile', 'label' => 'do { ... } while (...) ', 'line' => $stmt->getLine()];
            $bodyLast = $this->walkStmts($stmt->stmts, $nodes, $edges, $nextId, $id);
            return [$id, $bodyLast];
        }

        if ($stmt instanceof Node\Stmt\Switch_) {
            $vStr = $this->exprToString($stmt->cond);
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'switch', 'label' => "switch ($vStr)", 'line' => $stmt->getLine()];
            $prevCase = $id;
            $exitId = $id;
            foreach ($stmt->cases as $case) {
                $cid = $nextId++;
                $cLabel = $case->cond !== null ? "case " . $this->exprToString($case->cond) : 'default';
                $nodes[] = ['id' => $cid, 'type' => 'case', 'label' => $cLabel, 'line' => $case->getLine()];
                $edges[] = ['source' => $prevCase, 'target' => $cid, 'label' => ''];
                $caseLast = $this->walkStmts($case->stmts, $nodes, $edges, $nextId, $cid);
                $exitId = $caseLast;
                $prevCase = $cid;
            }
            return [$id, $exitId];
        }

        if ($stmt instanceof Node\Stmt\TryCatch) {
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'try', 'label' => 'try', 'line' => $stmt->getLine()];
            $bodyLast = $this->walkStmts($stmt->stmts, $nodes, $edges, $nextId, $id);
            $exitId = $bodyLast;
            foreach ($stmt->catches as $catch) {
                $ct = implode('|', array_map(fn($t) => $t->getLast() ?? 'Exception', $catch->types));
                $cid = $nextId++;
                $vName = $catch->var ? ('$' . $catch->var->name) : '';
                $nodes[] = ['id' => $cid, 'type' => 'catch', 'label' => "catch ($ct $vName)", 'line' => $catch->getLine()];
                $edges[] = ['source' => $id, 'target' => $cid, 'label' => 'throws'];
                $cLast = $this->walkStmts($catch->stmts, $nodes, $edges, $nextId, $cid);
                $exitId = $cLast;
            }
            return [$id, $exitId];
        }

        if ($stmt instanceof Node\Stmt\Return_) {
            $v = $stmt->expr ? $this->exprToString($stmt->expr) : '';
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'return', 'label' => $v ? "return $v" : 'return', 'line' => $stmt->getLine()];
            return [$id, $id];
        }

        if ($stmt instanceof Node\Stmt\Throw_) {
            $v = $this->exprToString($stmt->expr);
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'throw', 'label' => "throw $v", 'line' => $stmt->getLine()];
            return [$id, $id];
        }

        if ($stmt instanceof Node\Expr\Include_) {
            $target = $stmt->expr instanceof Node\Scalar\String_ ? $stmt->expr->value : '?';
            $type = $stmt->type === Node\Expr\Include_::TYPE_INCLUDE ? 'include' : 'require';
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'include', 'label' => "$type '$target'", 'line' => $stmt->getLine()];
            return [$id, $id];
        }

        if ($stmt instanceof Node\Expr\FuncCall) {
            $name = $stmt->name instanceof Node\Name ? implode('\\', $stmt->name->getParts()) : '?';
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'call', 'label' => "$name()", 'line' => $stmt->getLine()];
            return [$id, $id];
        }

        if ($stmt instanceof Node\Expr\MethodCall || $stmt instanceof Node\Expr\StaticCall) {
            $name = $stmt->name instanceof Node\Identifier ? $stmt->name->name : '?';
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'call', 'label' => "->$name()", 'line' => $stmt->getLine()];
            return [$id, $id];
        }

        if ($stmt instanceof Node\Stmt\Expression) {
            return $this->walkStmt($stmt->expr, $nodes, $edges, $nextId);
        }

        if ($stmt instanceof Node\Stmt\Class_) {
            $name = $stmt->name->name ?? 'anonymous';
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'class', 'label' => "class $name", 'line' => $stmt->getLine()];
            $last = $this->walkStmts($stmt->getMethods(), $nodes, $edges, $nextId, $id);
            return [$id, $last];
        }

        if ($stmt instanceof Node\Stmt\Namespace_) {
            $ns = $stmt->name ? implode('\\', $stmt->name->getParts()) : '';
            $id = $nextId++;
            $nodes[] = ['id' => $id, 'type' => 'block', 'label' => $ns ? "namespace $ns" : 'namespace', 'line' => $stmt->getLine()];
            $last = $this->walkStmts($stmt->stmts ?? [], $nodes, $edges, $nextId, $id);
            return [$id, $last];
        }

        return null;
    }

    private function exprToString(?Node $node): string
    {
        if ($node === null) return '';
        if ($node instanceof Node\Scalar\String_) return "'" . $node->value . "'";
        if ($node instanceof Node\Scalar\LNumber) return (string)$node->value;
        if ($node instanceof Node\Scalar\DNumber) return (string)$node->value;
        if ($node instanceof Node\Expr\Variable) return '$' . ($node->name ?? '?');
        if ($node instanceof Node\Expr\ArrayDimFetch) {
            return $this->exprToString($node->var) . '[' . $this->exprToString($node->dim) . ']';
        }
        if ($node instanceof Node\Expr\PropertyFetch) {
            return $this->exprToString($node->var) . '->' . ($node->name instanceof Node\Identifier ? $node->name->name : '?');
        }
        if ($node instanceof Node\Expr\MethodCall) {
            return $this->exprToString($node->var) . '->' . ($node->name instanceof Node\Identifier ? $node->name->name : '?') . '()';
        }
        if ($node instanceof Node\Expr\StaticCall) {
            $cn = $node->class instanceof Node\Name ? implode('\\', $node->class->getParts()) : '?';
            $mn = $node->name instanceof Node\Identifier ? $node->name->name : '?';
            return "$cn::$mn()";
        }
        if ($node instanceof Node\Expr\FuncCall) {
            $fn = $node->name instanceof Node\Name ? implode('\\', $node->name->getParts()) : '?';
            return "$fn()";
        }
        if ($node instanceof Node\Expr\BinaryOp\Identical) {
            return $this->exprToString($node->left) . ' === ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\NotIdentical) {
            return $this->exprToString($node->left) . ' !== ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Equal) {
            return $this->exprToString($node->left) . ' == ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\NotEqual) {
            return $this->exprToString($node->left) . ' != ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Greater) {
            return $this->exprToString($node->left) . ' > ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\GreaterOrEqual) {
            return $this->exprToString($node->left) . ' >= ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Smaller) {
            return $this->exprToString($node->left) . ' < ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\SmallerOrEqual) {
            return $this->exprToString($node->left) . ' <= ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Concat) {
            return $this->exprToString($node->left) . ' . ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Plus) {
            return $this->exprToString($node->left) . ' + ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Minus) {
            return $this->exprToString($node->left) . ' - ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Mul) {
            return $this->exprToString($node->left) . ' * ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Div) {
            return $this->exprToString($node->left) . ' / ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BooleanNot) {
            return '!' . $this->exprToString($node->expr);
        }
        if ($node instanceof Node\Expr\BooleanAnd || $node instanceof Node\Expr\BinaryOp\LogicalAnd) {
            return $this->exprToString($node->left) . ' && ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BooleanOr || $node instanceof Node\Expr\BinaryOp\LogicalOr) {
            return $this->exprToString($node->left) . ' || ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\BinaryOp\Coalesce) {
            return $this->exprToString($node->left) . ' ?? ' . $this->exprToString($node->right);
        }
        if ($node instanceof Node\Expr\Ternary) {
            return $this->exprToString($node->cond) . ' ? ' . $this->exprToString($node->if) . ' : ' . $this->exprToString($node->else);
        }
        if ($node instanceof Node\Expr\Assign) {
            return $this->exprToString($node->var) . ' = ' . $this->exprToString($node->expr);
        }
        if ($node instanceof Node\Expr\New_) {
            $cn = $node->class instanceof Node\Name ? implode('\\', $node->class->getParts()) : '?';
            return "new $cn()";
        }
        if ($node instanceof Node\Expr\NullsafeMethodCall) {
            return $this->exprToString($node->var) . '?->' . ($node->name instanceof Node\Identifier ? $node->name->name : '?') . '()';
        }
        if ($node instanceof Node\Expr\NullsafePropertyFetch) {
            return $this->exprToString($node->var) . '?->' . ($node->name instanceof Node\Identifier ? $node->name->name : '?');
        }
        if ($node instanceof Node\Expr\ConstFetch) {
            return implode('\\', $node->name->getParts());
        }
        if ($node instanceof Node\Expr\Clone_) {
            return 'clone ' . $this->exprToString($node->expr);
        }
        if ($node instanceof Node\Expr\Instanceof_) {
            $cn = $node->class instanceof Node\Name ? implode('\\', $node->class->getParts()) : '?';
            return $this->exprToString($node->expr) . " instanceof $cn";
        }
        if ($node instanceof Node\Expr\Array_) {
            return '[...]';
        }
        if ($node instanceof Node\Expr\Closure) {
            return 'function(...)';
        }
        if ($node instanceof Node\Expr\ArrowFunction) {
            return 'fn(...)';
        }
        if ($node instanceof Node\Expr\UnaryMinus) {
            return '-' . $this->exprToString($node->expr);
        }
        if ($node instanceof Node\Expr\UnaryPlus) {
            return '+' . $this->exprToString($node->expr);
        }
        if ($node instanceof Node\Expr\PostInc) {
            return $this->exprToString($node->var) . '++';
        }
        if ($node instanceof Node\Expr\PostDec) {
            return $this->exprToString($node->var) . '--';
        }
        if ($node instanceof Node\Expr\PreInc) {
            return '++' . $this->exprToString($node->var);
        }
        if ($node instanceof Node\Expr\PreDec) {
            return '--' . $this->exprToString($node->var);
        }
        if ($node instanceof Node\Expr\Cast\Int_) return '(int)' . $this->exprToString($node->expr);
        if ($node instanceof Node\Expr\Cast\String_) return '(string)' . $this->exprToString($node->expr);
        if ($node instanceof Node\Expr\Cast\Array_) return '(array)' . $this->exprToString($node->expr);
        if ($node instanceof Node\Expr\Cast\Bool_) return '(bool)' . $this->exprToString($node->expr);
        if ($node instanceof Node\Expr\Cast\Object_) return '(object)' . $this->exprToString($node->expr);
        if ($node instanceof Node\Expr\ErrorSuppress) return '@' . $this->exprToString($node->expr);
        if ($node instanceof Node\Expr\Empty_) return 'empty(' . $this->exprToString($node->expr) . ')';
        if ($node instanceof Node\Expr\Isset_) {
            $parts = array_map(fn($v) => $this->exprToString($v), $node->vars);
            return 'isset(' . implode(', ', $parts) . ')';
        }
        if ($node instanceof Node\Expr\ClassConstFetch) {
            $cn = $node->class instanceof Node\Name ? implode('\\', $node->class->getParts()) : '?';
            $cnst = $node->name instanceof Node\Identifier ? $node->name->name : '?';
            return "$cn::$cnst";
        }
        if ($node instanceof Node\Scalar\MagicConst\Class_) return '__CLASS__';
        if ($node instanceof Node\Scalar\MagicConst\Line) return '__LINE__';
        if ($node instanceof Node\Scalar\MagicConst\File) return '__FILE__';
        if ($node instanceof Node\Scalar\MagicConst\Dir) return '__DIR__';
        if ($node instanceof Node\Scalar\MagicConst\Function_) return '__FUNCTION__';
        if ($node instanceof Node\Scalar\MagicConst\Method) return '__METHOD__';
        if ($node instanceof Node\Scalar\MagicConst\Namespace_) return '__NAMESPACE__';
        if ($node instanceof Node\Scalar\MagicConst\Trait_) return '__TRAIT__';
        return '?';
    }
}

class AnalysisContext
{
    public string $relativePath;
    public string $namespace = '';
    public array $dependencies = [];
    public array $dbReferences = [];
    public array $classes = [];
    public array $traits = [];
    public array $interfaces = [];
    public array $functions = [];
    public array $flowGraph = [];

    public function __construct(string $relativePath)
    {
        $this->relativePath = $relativePath;
    }
}

class FileAnalysisVisitor extends NodeVisitorAbstract
{
    private AnalysisContext $context;
    private ?string $currentClassName = null;
    private bool $currentClassIsModel = false;

    public function __construct(AnalysisContext $context)
    {
        $this->context = $context;
    }

    public function enterNode(Node $node): void
    {
        if ($node instanceof Node\Stmt\Namespace_) {
            $this->context->namespace = $node->name ? implode('\\', $node->name->getParts()) : '';
        }

        if ($node instanceof Node\Stmt\UseUse) {
            $target = $node->name ? implode('\\', $node->name->getParts()) : '';
            if ($target) {
                $this->context->dependencies[] = [
                    'type' => 'use',
                    'target' => $target,
                    'resolvedPath' => null,
                    'line' => $node->getLine(),
                ];
            }
        }

        if ($node instanceof Node\Expr\Include_) {
            $expr = $node->expr;
            $target = '';
            if ($expr instanceof Node\Scalar\String_) {
                $target = $expr->value;
            }
            if ($target) {
                $includeType = $node->type === Node\Expr\Include_::TYPE_INCLUDE ? 'include' : 'require';
                $this->context->dependencies[] = [
                    'type' => $includeType,
                    'target' => $target,
                    'resolvedPath' => null,
                    'line' => $node->getLine(),
                ];
            }
        }

        if ($node instanceof Node\Stmt\Class_) {
            if ($node->name) {
                $name = $node->name->name;
                $extends = $node->extends ? implode('\\', $node->extends->getParts()) : null;
                $implements = [];
                foreach ($node->implements as $impl) {
                    $implements[] = implode('\\', $impl->getParts());
                }
                $methods = [];
                $props = [];
                foreach ($node->getMethods() as $method) {
                    $methods[] = $method->name->name;
                }
                foreach ($node->getProperties() as $prop) {
                    foreach ($prop->props as $p) {
                        $props[] = $p->name->name;
                    }
                }
                $this->context->classes[] = [
                    'name' => $name,
                    'namespace' => $this->context->namespace,
                    'fullName' => $this->context->namespace ? $this->context->namespace . '\\' . $name : $name,
                    'type' => $node->isAbstract() ? 'abstract class' : 'class',
                    'methods' => $methods,
                    'properties' => $props,
                    'extends' => $extends,
                    'implements' => $implements,
                ];

                $this->currentClassName = $name;
                $this->currentClassIsModel = $extends !== null && (
                    $extends === 'Model' ||
                    str_ends_with($extends, '\\Model') ||
                    $extends === 'Eloquent' ||
                    str_ends_with($extends, '\\Eloquent')
                );

                // Custom $table property
                foreach ($node->getProperties() as $prop) {
                    foreach ($prop->props as $p) {
                        if ($p->name->name === 'table' && $p->default instanceof Node\Scalar\String_) {
                            $table = $p->default->value;
                            $this->context->dbReferences[] = [
                                'table' => $table,
                                'operation' => 'ELOQUENT_TABLE',
                                'context' => "class $name \$table = '$table'",
                                'line' => $node->getLine(),
                            ];
                        }
                    }
                }
            }
        }

        if ($node instanceof Node\Stmt\Interface_) {
            if ($node->name) {
                $this->context->interfaces[] = $node->name->name;
            }
        }

        if ($node instanceof Node\Stmt\Trait_) {
            if ($node->name) {
                $this->context->traits[] = $node->name->name;
            }
        }

        if ($node instanceof Node\Stmt\Function_) {
            if ($node->name) {
                $this->context->functions[] = $node->name->name;
            }
        }

        // ── Eloquent relationship definitions inside model methods ──
        if ($this->currentClassIsModel && $node instanceof Node\Expr\MethodCall &&
            $node->var instanceof Node\Expr\Variable && $node->var->name === 'this') {
            $this->detectEloquentRelationship($node);
        }

        // ── Eloquent relationship access on $this (non-method, e.g. $this->posts) ──
        if ($this->currentClassIsModel && $node instanceof Node\Expr\PropertyFetch &&
            $node->var instanceof Node\Expr\Variable && $node->var->name === 'this' &&
            $node->name instanceof Node\Identifier) {
            $relName = $node->name->name;
            if ($relName && !in_array($relName, ['id', 'exists', 'timestamps', 'incrementing', 'table', 'fillable', 'guarded', 'hidden', 'visible', 'appends', 'casts', 'dates', 'dates', 'with', 'withCount'], true)) {
                $table = $this->relationshipNameToTable($relName);
                if ($table) {
                    $this->context->dbReferences[] = [
                        'table' => $table,
                        'operation' => 'ELOQUENT_REL_ACCESS',
                        'context' => "\$this->$relName",
                        'line' => $node->getLine(),
                    ];
                }
            }
        }

        // ── Eloquent eager loading / existence checks ──
        if ($node instanceof Node\Expr\StaticCall && $node->class instanceof Node\Name && !empty($node->args)) {
            $method = $node->name instanceof Node\Identifier ? $node->name->name : '';
            if (in_array($method, ['with', 'load', 'has', 'doesntHave', 'orHas', 'orDoesntHave', 'whereHas', 'orWhereHas', 'whereDoesntHave', 'orWhereDoesntHave', 'withCount'], true)) {
                $this->extractEloquentRelationsFromArgs($node->args, 'ELOQUENT_' . strtoupper($method), $node->getLine());
            }
        }

        // ── Pivot operations: $user->roles()->attach/sync/detach ──
        if ($node instanceof Node\Expr\MethodCall && $node->var instanceof Node\Expr\MethodCall) {
            $outerMethod = $node->name instanceof Node\Identifier ? $node->name->name : '';
            if (in_array($outerMethod, ['attach', 'detach', 'sync', 'syncWithoutDetaching', 'toggle', 'save', 'saveMany', 'create', 'createMany', 'associate', 'dissociate'], true)) {
                $innerMethod = $node->var->name instanceof Node\Identifier ? $node->var->name->name : '';
                if ($innerMethod) {
                    $table = $this->relationshipNameToTable($innerMethod);
                    if ($table) {
                        $this->context->dbReferences[] = [
                            'table' => $table,
                            'operation' => 'ELOQUENT_REL_CHAIN',
                            'context' => "->$innerMethod()->$outerMethod(...)",
                            'line' => $node->getLine(),
                        ];
                    }
                }
            }
        }

        // ── DB::table(), Schema::create(), etc. ──
        if ($node instanceof Node\Expr\StaticCall && $node->class instanceof Node\Name) {
            $className = implode('\\', $node->class->getParts());
            $method = $node->name instanceof Node\Identifier ? $node->name->name : '';
            if ($method && !empty($node->args) && in_array($className, ['DB', 'Schema', '\\DB', '\\Schema'], true)) {
                $tableMethods = ['table', 'create', 'drop', 'hasTable', 'rename', 'from', 'hasColumn'];
                if (in_array($method, $tableMethods, true) && $node->args[0]->value instanceof Node\Scalar\String_) {
                    $table = $node->args[0]->value->value;
                    $this->context->dbReferences[] = [
                        'table' => $table,
                        'operation' => 'AST_' . strtoupper($method),
                        'context' => trim(substr("{$className}::{$method}('{$table}')", 0, 120)),
                        'line' => $node->getLine(),
                    ];
                }
            }
        }

        // ── Raw SQL strings ──
        if ($node instanceof Node\Scalar\String_) {
            $sql = $node->value;
            if (is_string($sql) && preg_match('/\b(SELECT\s.+?\bFROM|INSERT\s+INTO|UPDATE\s+\w+|DELETE\s.+?\bFROM)\b/si', $sql)) {
                $tablePatterns = [
                    '/\bFROM\b\s+[`\'"]?([a-zA-Z_]\w*)[`\'"]?/si',
                    '/\bINTO\b\s+[`\'"]?([a-zA-Z_]\w*)[`\'"]?/si',
                    '/\bUPDATE\b\s+[`\'"]?([a-zA-Z_]\w*)[`\'"]?\s+SET\b/si',
                ];
                foreach ($tablePatterns as $pat) {
                    if (preg_match($pat, $sql, $m)) {
                        $this->context->dbReferences[] = [
                            'table' => $m[1],
                            'operation' => 'AST_SQL',
                            'context' => trim(substr($sql, 0, 120)),
                            'line' => $node->getLine(),
                        ];
                    }
                }
            }
        }
    }

    public function leaveNode(Node $node): void
    {
        if ($node instanceof Node\Stmt\Class_) {
            $this->currentClassName = null;
            $this->currentClassIsModel = false;
        }
    }

    // ── Helpers ──

    private function detectEloquentRelationship(Node\Expr\MethodCall $node): void
    {
        $method = $node->name instanceof Node\Identifier ? $node->name->name : '';
        $relMethods = ['hasMany', 'hasOne', 'belongsTo', 'belongsToMany', 'hasManyThrough', 'hasOneThrough', 'morphMany', 'morphToMany', 'morphedByMany'];
        if (!in_array($method, $relMethods, true)) return;

        $args = $node->args;
        if (empty($args)) return;

        $relatedClass = $this->extractClassName($args[0]->value);
        if (!$relatedClass) return;

        $shortName = basename(str_replace('\\', '/', $relatedClass));
        $snake = self::pascalToSnake($shortName);
        $plural = self::pluralize($snake);

        $op = 'ELOQUENT_' . strtoupper($method);
        $this->context->dbReferences[] = [
            'table' => $plural,
            'operation' => $op,
            'context' => "$method($shortName)",
            'line' => $node->getLine(),
        ];

        // belongsToMany: pivot table (explicit or inferred)
        if ($method === 'belongsToMany' && $this->currentClassName) {
            if (count($args) >= 2 && $args[1]->value instanceof Node\Scalar\String_) {
                $pivot = $args[1]->value->value;
                $this->context->dbReferences[] = [
                    'table' => $pivot,
                    'operation' => 'ELOQUENT_PIVOT',
                    'context' => "belongsToMany pivot: $pivot",
                    'line' => $node->getLine(),
                ];
            } else {
                // Infer pivot: singular model names in alphabetical order
                $models = [strtolower($this->currentClassName), strtolower($shortName)];
                sort($models);
                $pivot = $models[0] . '_' . $models[1];
                $this->context->dbReferences[] = [
                    'table' => $pivot,
                    'operation' => 'ELOQUENT_PIVOT',
                    'context' => "belongsToMany inferred pivot: $pivot",
                    'line' => $node->getLine(),
                ];
            }
        }
    }

    private function extractEloquentRelationsFromArgs(array $args, string $operation, int $line): void
    {
        if (empty($args)) return;
        $first = $args[0]->value;

        if ($first instanceof Node\Scalar\String_) {
            $this->addEloquentRelationRef($first->value, $operation, $line);
        } elseif ($first instanceof Node\Expr\Array_) {
            foreach ($first->items as $item) {
                if (!$item) continue;
                $val = $item->value;
                if ($val instanceof Node\Scalar\String_) {
                    $this->addEloquentRelationRef($val->value, $operation, $line);
                } elseif ($item->key instanceof Node\Scalar\String_ && $val instanceof Node\Expr\Closure) {
                    $this->addEloquentRelationRef($item->key->value, $operation, $line);
                }
            }
        }
    }

    private function addEloquentRelationRef(string $relation, string $operation, int $line): void
    {
        // Strip constraints: 'posts:name,id' → 'posts'
        $name = explode(':', $relation)[0];
        $table = $this->relationshipNameToTable($name);
        if ($table) {
            $this->context->dbReferences[] = [
                'table' => $table,
                'operation' => $operation,
                'context' => $relation,
                'line' => $line,
            ];
        }
    }

    private function extractClassName($value): ?string
    {
        if ($value instanceof Node\Expr\ClassConstFetch && $value->class instanceof Node\Name) {
            return implode('\\', $value->class->getParts());
        }
        if ($value instanceof Node\Scalar\String_) {
            return $value->value;
        }
        return null;
    }

    /**
     * Convert a relationship name to a likely table name.
     * e.g. 'posts' → 'posts', 'roles' → 'roles', 'mainPost' → 'main_posts', 'settings' → 'settings'
     */
    private function relationshipNameToTable(string $name): ?string
    {
        if (strlen($name) < 2) return null;
        $snake = self::camelToSnake($name);
        // If already ends in 's' (likely already plural), use as-is
        if (str_ends_with($snake, 's')) return $snake;
        // Common words that stay singular
        if (in_array($snake, ['this', 'data', 'info', 'status', 'news', 'series'], true)) return $snake;
        return self::pluralize($snake);
    }

    private static function camelToSnake(string $name): string
    {
        return strtolower(preg_replace('/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/', '_', $name));
    }

    private static function pascalToSnake(string $name): string
    {
        return self::camelToSnake($name);
    }

    /**
     * Simple English pluralizer for table names.
     * e.g. 'product' → 'products', 'category' → 'categories', 'box' → 'boxes'
     */
    private static function pluralize(string $word): string
    {
        $lower = strtolower($word);
        // Uncountable / irregular
        $irregular = ['child' => 'children', 'person' => 'people', 'man' => 'men',
            'woman' => 'women', 'foot' => 'feet', 'tooth' => 'teeth',
            'mouse' => 'mice', 'sheep' => 'sheep', 'deer' => 'deer', 'fish' => 'fish',
            'news' => 'news', 'series' => 'series', 'species' => 'species',
            'status' => 'statuses', 'data' => 'data', 'info' => 'info'];
        if (isset($irregular[$lower])) return $irregular[$lower];

        // Ends in s, ss, sh, ch, x, z → add 'es'
        if (str_ends_with($lower, 's') || str_ends_with($lower, 'ss') || str_ends_with($lower, 'sh') ||
            str_ends_with($lower, 'ch') || str_ends_with($lower, 'x') || str_ends_with($lower, 'z')) {
            return $word . 'es';
        }
        // Ends in consonant + y → ies
        if (str_ends_with($lower, 'y') && !in_array($lower, ['key', 'boy', 'toy', 'day', 'way', 'may', 'guy'])) {
            return substr($word, 0, -1) . 'ies';
        }
        // Ends in f/fe → ves
        if (str_ends_with($lower, 'fe')) return substr($word, 0, -2) . 'ves';
        if (str_ends_with($lower, 'f') && !in_array($lower, ['roof', 'proof', 'belief', 'chief', 'cliff'])) {
            return substr($word, 0, -1) . 'ves';
        }
        // Ends in o → oes (but not all: piano → pianos)
        if (str_ends_with($lower, 'o') && !in_array($lower, ['photo', 'piano', 'solo', 'logo', 'memo', 'todo'])) {
            return $word . 'es';
        }
        return $word . 's';
    }
}
