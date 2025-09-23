import React from 'react';
import { useState, useMemo } from 'react';
// Fix: Imported TableName type from types.ts for consistency.
import { Item, ItemStatus, TableName } from './types';
import { ItemCard } from './components/ItemCard';
import { ClipboardIcon, SpinnerIcon, SearchIcon, XIcon } from './components/Icons';

const initialInput = `nhập nội dung vào đây.
`;

const TABLE_CONFIG = {
    avatars: { id: 0, name: 1, url: 2, desc: 3 },
    beast_eggs: { id: 0, name: 1, url: 6, desc: 2 },
    divine_beasts: { id: 0, name: 1, url: 7, desc: 2, isJsonUrl: true },
    equipment: { id: 0, name: 1, url: 7, desc: 2 },
    herbs: { id: 0, name: 1, url: 3, desc: 2 },
    pills: { id: 0, name: 1, url: 5, desc: 2 },
};

// Fix: Removed local TableName definition, as it is now imported from types.ts.

// A robust parser for a single line of SQL VALUES
function parseSqlValues(line: string): any[] {
  const content = line.trim().slice(1, -2); // From `\t(v1, v2, ...);` to `v1, v2, ...`

  const values: any[] = [];
  let i = 0;
  while (i < content.length) {
    // Skip leading whitespace/commas
    while ((content[i] === ' ' || content[i] === ',') && i < content.length) i++;
    if (i >= content.length) break;

    if (content[i] === "'") {
      // String value
      i++; // move past opening quote
      let value = '';
      while (i < content.length) {
        if (content[i] === "'") {
          if (i + 1 < content.length && content[i+1] === "'") { // Escaped quote ''
            value += "'";
            i += 2;
          } else { // End of string
            i++;
            break;
          }
        } else {
          value += content[i];
          i++;
        }
      }
      values.push(value);
    } else {
      // Number, NULL, or JSON value
      let endIndex = content.indexOf(',', i);
      if (endIndex === -1) endIndex = content.length;

      // This is a bit of a trick: find the real end by checking for balanced brackets/braces
      let openBrackets = 0;
      for (let j = i; j < content.length; j++) {
          if (content[j] === '[' || content[j] === '{') openBrackets++;
          if (content[j] === ']' || content[j] === '}') openBrackets--;
          if (content[j] === ',' && openBrackets === 0) {
              endIndex = j;
              break;
          }
      }

      const rawValue = content.substring(i, endIndex).trim();
      
      if (rawValue === 'NULL') {
        values.push(null);
      } else if (!isNaN(Number(rawValue)) && !rawValue.startsWith("'")) {
        values.push(Number(rawValue));
      } else {
        values.push(rawValue); // JSON string or other unquoted value
      }
      i = endIndex;
    }
  }
  return values;
}


const App: React.FC = () => {
  const [rawText, setRawText] = useState<string>(initialInput);
  const [items, setItems] = useState<Item[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [findText, setFindText] = useState<string>('');
  const [replaceText, setReplaceText] = useState<string>('');
  const [errorReplaceUrl, setErrorReplaceUrl] = useState<string>('');
  const [copyStatus, setCopyStatus] = useState<string>('Copy Modified SQL');
  const [activeFilters, setActiveFilters] = useState<Set<TableName>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [currentErrorIndex, setCurrentErrorIndex] = useState(-1);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);


  const parseAndSetItems = () => {
    const newItems: Item[] = [];
    const lines = rawText.split('\n');
    let currentTable: TableName | null = null;
    let columnIndices: typeof TABLE_CONFIG[TableName] | null = null;

    for (const line of lines) {
        const tableNameMatch = line.match(/REPLACE INTO \`(.+?)\`/);
        if (tableNameMatch) {
            const tableName = tableNameMatch[1] as TableName;
            if (TABLE_CONFIG[tableName]) {
                currentTable = tableName;
                columnIndices = TABLE_CONFIG[tableName];
            } else {
                currentTable = null;
            }
            continue;
        }

        if (currentTable && columnIndices && line.match(/^\s*\(/)) {
            const values = parseSqlValues(line);
            if (values.length === 0) continue;

            const id = values[columnIndices.id] ?? 'unknown';
            const name = values[columnIndices.name] ?? 'Unknown Name';
            const description = values[columnIndices.desc] ?? '';
            
            // Fix: Use 'in' operator for type-safe property checking on a union type.
            if ('isJsonUrl' in columnIndices && columnIndices.isJsonUrl) {
                try {
                    const urlData = JSON.parse(values[columnIndices.url]);
                    if (Array.isArray(urlData)) {
                        urlData.forEach((urlEntry, index) => {
                            if (urlEntry && typeof urlEntry.url === 'string') {
                                newItems.push({
                                    internalId: crypto.randomUUID(),
                                    id, tableName: currentTable as TableName, name: `${name} (Aptitude ${urlEntry.aptitude || index + 1})`, description,
                                    url: urlEntry.url, status: ItemStatus.IDLE, originalLine: line, subKey: urlEntry.aptitude || index,
                                });
                            }
                        });
                    }
                } catch (e) { /* ignore json parse errors */ }
            } else {
                const url = values[columnIndices.url];
                if (typeof url === 'string' && url.trim()) {
                    newItems.push({
                        internalId: crypto.randomUUID(),
                        id, tableName: currentTable as TableName, name, description,
                        url, status: ItemStatus.IDLE, originalLine: line,
                    });
                }
            }
        }
    }
    setItems(newItems);
    setActiveFilters(new Set(Object.keys(TABLE_CONFIG) as TableName[]));
    return newItems;
  };


  const checkImage = (url: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        resolve(false);
        return;
      }
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  };

  const processAndCheckLinks = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setHighlightedItemId(null);
    setCurrentErrorIndex(-1);
    
    const parsedItems = parseAndSetItems();
    setItems(parsedItems.map(item => ({ ...item, status: ItemStatus.CHECKING })));

    // Use Promise.all for parallel checking
    const checkPromises = parsedItems.map(async (item) => {
        const isOk = await checkImage(item.url);
        return { internalId: item.internalId, status: isOk ? ItemStatus.OK : ItemStatus.ERROR };
    });

    // Stagger updates to avoid re-rendering bottleneck
    for (const promise of checkPromises) {
        const result = await promise;
        setItems(current => current.map(i => i.internalId === result.internalId ? { ...i, status: result.status } : i));
    }
    
    setIsProcessing(false);
  };
    
  const handleRecheck = async (internalId: string) => {
    const itemToCheck = items.find(i => i.internalId === internalId);
    if (!itemToCheck) return;

    setItems(current => current.map(i => i.internalId === internalId ? { ...i, status: ItemStatus.CHECKING } : i));
    const isOk = await checkImage(itemToCheck.url);
    setItems(current => current.map(i => i.internalId === internalId ? { ...i, status: isOk ? ItemStatus.OK : ItemStatus.ERROR } : i));
  };

  const handleUrlChange = (internalId: string, newUrl: string) => {
    const item = items.find(i => i.internalId === internalId);
    if (!item) return;

    let newLine = '';
    const oldUrl = item.url;

    if (item.tableName === 'divine_beasts' && typeof item.subKey !== 'undefined') {
        const values = parseSqlValues(item.originalLine);
        const urlColIndex = TABLE_CONFIG.divine_beasts.url;
        try {
            const urlData = JSON.parse(values[urlColIndex]);
            const urlEntry = urlData.find((e: any) => (e.aptitude || urlData.indexOf(e)) === item.subKey);
            if(urlEntry) urlEntry.url = newUrl;
            const newJsonString = JSON.stringify(urlData);
            const oldJsonString = values[urlColIndex];
            newLine = item.originalLine.replace(`'${oldJsonString}'`, `'${newJsonString}'`);
        } catch(e) { return; }
    } else {
        newLine = item.originalLine.replace(`'${oldUrl}'`, `'${newUrl}'`);
    }

    const newRawText = rawText.replace(item.originalLine, newLine);
    setRawText(newRawText);

    setItems(current =>
      current.map(i => {
        let newItem = i;
        // Update originalLine for all items that shared it
        if (i.originalLine === item.originalLine) {
            newItem = { ...newItem, originalLine: newLine };
        }
        // Update the specific item's URL
        if (i.internalId === internalId) {
            newItem = { ...newItem, url: newUrl, status: ItemStatus.IDLE };
        }
        return newItem;
      })
    );
    
    setTimeout(() => handleRecheck(internalId), 10);
  };
    
  const handleBulkReplace = () => {
    if (!findText || isProcessing || items.length === 0) return;
  
    let newRawText = rawText;
    const updatedItems = items.map(item => {
      if (!item.url.includes(findText)) return item;
  
      const newUrl = item.url.split(findText).join(replaceText);
      const newLine = item.originalLine.replace(`'${item.url}'`, `'${newUrl}'`);
      
      if (newRawText.includes(item.originalLine)) {
         newRawText = newRawText.replace(item.originalLine, newLine);
      }
  
      return {
        ...item,
        url: newUrl,
        originalLine: newLine, 
        status: ItemStatus.IDLE
      };
    });
    
    setRawText(newRawText);
    setItems(updatedItems);
  
    setTimeout(async () => {
      setIsProcessing(true);
      const itemsToCheck = updatedItems.filter(i => i.status === ItemStatus.IDLE);
      for (const item of itemsToCheck) {
        setItems(current => current.map(i => i.internalId === item.internalId ? { ...i, status: ItemStatus.CHECKING } : i));
        const isOk = await checkImage(item.url);
        setItems(current => current.map(i => i.internalId === item.internalId ? { ...i, status: isOk ? ItemStatus.OK : ItemStatus.ERROR } : i));
      }
      setIsProcessing(false);
    }, 10);
  };

  const handleReplaceErrors = () => {
    const errorItems = items.filter(i => i.status === ItemStatus.ERROR);
    if (!errorReplaceUrl || isProcessing || errorItems.length === 0) return;

    let currentRawText = rawText;
    const lineReplacements = new Map<string, string>();

    errorItems.forEach(item => {
        const oldLine = lineReplacements.get(item.originalLine) || item.originalLine;
        const newLine = oldLine.replace(`'${item.url}'`, `'${errorReplaceUrl}'`);
        lineReplacements.set(item.originalLine, newLine);
    });

    lineReplacements.forEach((newLine, oldLine) => {
        currentRawText = currentRawText.replace(oldLine, newLine);
    });
    setRawText(currentRawText);

    setItems(currentItems => currentItems.map(item => {
        const newLine = lineReplacements.get(item.originalLine);
        if (newLine) {
            let updatedItem = { ...item, originalLine: newLine };
            if (item.status === ItemStatus.ERROR) {
                updatedItem = { ...updatedItem, url: errorReplaceUrl, status: ItemStatus.IDLE };
            }
            return updatedItem;
        }
        return item;
    }));

    setTimeout(async () => {
        setIsProcessing(true);
        const itemsToCheck = items.filter(i => i.status === ItemStatus.ERROR);
        for (const item of itemsToCheck) {
            setItems(current => current.map(i => i.internalId === item.internalId ? { ...i, status: ItemStatus.CHECKING } : i));
            const isOk = await checkImage(errorReplaceUrl);
            setItems(current => current.map(i => i.internalId === item.internalId ? { ...i, status: isOk ? ItemStatus.OK : ItemStatus.ERROR } : i));
        }
        setIsProcessing(false);
    }, 10);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(rawText);
    setCopyStatus('Copied!');
    setTimeout(() => setCopyStatus('Copy Modified SQL'), 2000);
  };
  
  const toggleFilter = (tableName: TableName) => {
    const newFilters = new Set(activeFilters);
    if (newFilters.has(tableName)) {
      newFilters.delete(tableName);
    } else {
      newFilters.add(tableName);
    }
    setActiveFilters(newFilters);
  };
    
  const filteredItems = useMemo(() => {
    return items
        .filter(item => activeFilters.has(item.tableName))
        .filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [items, activeFilters, searchQuery]);
  
  const handleJumpToNextError = () => {
    const errorItems = filteredItems.filter(item => item.status === ItemStatus.ERROR);
    if (errorItems.length === 0) return;

    const nextIndex = (currentErrorIndex + 1) % errorItems.length;
    const nextErrorItem = errorItems[nextIndex];

    setCurrentErrorIndex(nextIndex);
    setHighlightedItemId(nextErrorItem.internalId);

    const element = document.getElementById(`item-${nextErrorItem.internalId}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const stats = React.useMemo(() => {
    const total = filteredItems.length;
    const ok = filteredItems.filter(i => i.status === ItemStatus.OK).length;
    const error = filteredItems.filter(i => i.status === ItemStatus.ERROR).length;
    const checking = filteredItems.filter(i => i.status === ItemStatus.CHECKING).length;
    const totalError = items.filter(i => i.status === ItemStatus.ERROR).length;
    return { total, ok, error, checking, totalError };
  }, [items, filteredItems]);

  const handleFile = (file: File) => {
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === 'string') {
          setRawText(text);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-900">
      {/* Controls Panel */}
      <aside className="w-full md:w-1/3 lg:w-1/4 p-6 bg-gray-900/80 backdrop-blur-sm md:sticky md:top-0 md:h-screen overflow-y-auto border-r border-gray-700/50">
        <div className="flex items-center mb-6">
            <h1 className="text-2xl font-bold text-white">SQL Link Validator</h1>
        </div>
        
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <label htmlFor="raw-input" className="block text-sm font-medium text-gray-400">Paste your SQL data here:</label>
            <label htmlFor="file-upload" className="text-sm font-medium text-cyan-400 hover:text-cyan-300 cursor-pointer">
              Or upload a file
            </label>
            <input id="file-upload" type="file" className="hidden" onChange={handleFileChange} />
          </div>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative transition-all duration-200 rounded-md ${isDragging ? 'border-2 border-dashed border-cyan-500 bg-gray-800/50' : 'border-2 border-transparent'}`}
          >
            {isDragging && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-cyan-400 font-semibold mt-2">Drop your file here</p>
              </div>
            )}
            <textarea
              id="raw-input"
              className={`w-full h-48 bg-gray-800 border border-gray-700 rounded-md text-gray-300 p-3 text-xs font-mono focus:ring-2 focus:ring-cyan-500 focus:outline-none transition ${isDragging ? 'opacity-20 blur-sm' : ''}`}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Paste SQL script or drop a file (.sql, .txt, .js, etc)..."
            />
          </div>
        </div>

        <button
          onClick={processAndCheckLinks}
          disabled={isProcessing}
          className="w-full bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-500 text-white font-bold py-3 px-4 rounded-md transition duration-300 flex items-center justify-center"
        >
          {isProcessing ? <><SpinnerIcon className="w-5 h-5 mr-2" /> Processing...</> : 'Parse & Check Links'}
        </button>

        {items.length > 0 && (
            <div className="my-6 pt-6 border-t border-gray-700/50 space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-white mb-3">Filter by Table</h2>
                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(TABLE_CONFIG) as TableName[]).map(tableName => (
                            <button key={tableName} onClick={() => toggleFilter(tableName)}
                                className={`px-3 py-1 text-sm font-medium rounded-full transition-colors ${activeFilters.has(tableName) ? 'bg-cyan-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
                                {tableName}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-white mb-3">Search by Name</h2>
                    <div className="relative">
                        <SearchIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"/>
                        <input type="search" placeholder="Search for items..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 pl-10 text-sm focus:ring-2 focus:ring-cyan-500 focus:outline-none" />
                         {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                                <XIcon className="w-5 h-5"/>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        )}

        <div className="my-6 pt-6 border-t border-gray-700/50">
          <h2 className="text-lg font-semibold text-white mb-3">Bulk Replace URL</h2>
          <div className="space-y-3">
            <input type="text" placeholder="Find..." value={findText} onChange={(e) => setFindText(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-sm focus:ring-2 focus:ring-cyan-500 focus:outline-none" />
            <input type="text" placeholder="Replace with..." value={replaceText} onChange={(e) => setReplaceText(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-sm focus:ring-2 focus:ring-cyan-500 focus:outline-none" />
          </div>
          <button onClick={handleBulkReplace} disabled={!findText || isProcessing || items.length === 0} className="w-full mt-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition duration-300">
            Replace All
          </button>
        </div>

        <div className="my-6 pt-6 border-t border-gray-700/50">
            <h2 className="text-lg font-semibold text-white mb-3">Fix All Errors</h2>
            <p className="text-xs text-gray-500 mb-2">Replace all broken image links with a single URL.</p>
            <div className="space-y-3">
            <input type="text" placeholder="New URL for all errors..." value={errorReplaceUrl} onChange={(e) => setErrorReplaceUrl(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-sm focus:ring-2 focus:ring-cyan-500 focus:outline-none" />
            </div>
            <button onClick={handleReplaceErrors} disabled={!errorReplaceUrl || isProcessing || stats.totalError === 0} className="w-full mt-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition duration-300">
             Replace All Errors ({stats.totalError})
            </button>
        </div>

        <div className="my-6 pt-6 border-t border-gray-700/50">
             <h2 className="text-lg font-semibold text-white mb-3">Get Modified SQL</h2>
            <button onClick={handleCopy} disabled={items.length === 0} className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold py-3 px-4 rounded-md transition duration-300 flex items-center justify-center">
                <ClipboardIcon className="w-5 h-5 mr-2" /> {copyStatus}
            </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="w-full md:w-2/3 lg:w-3/4 p-6 overflow-y-auto md:h-screen">
        {items.length > 0 ? (
            <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 bg-gray-800/50 p-4 rounded-lg sticky top-0 backdrop-blur-sm z-10">
                <div className="text-center"><div className="text-2xl font-bold">{stats.total}</div><div className="text-sm text-gray-400">Displayed</div></div>
                <div className="text-center"><div className="text-2xl font-bold text-green-400">{stats.ok}</div><div className="text-sm text-gray-400">Valid</div></div>
                <div className="text-center">
                    <button onClick={handleJumpToNextError} disabled={stats.error === 0} className="w-full text-center group disabled:cursor-not-allowed">
                        <div className="text-2xl font-bold text-red-400">{stats.error}</div>
                        <div className="text-sm text-gray-400 group-enabled:group-hover:text-red-300 transition-colors">Errors (Click to find)</div>
                    </button>
                </div>
                <div className="text-center"><div className="text-2xl font-bold text-yellow-400">{stats.checking}</div><div className="text-sm text-gray-400">Checking</div></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {filteredItems.map(item => (
                <ItemCard 
                    key={item.internalId} 
                    item={item} 
                    onUrlChange={handleUrlChange}
                    onRecheck={handleRecheck}
                    isHighlighted={item.internalId === highlightedItemId}
                />
                ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h2 className="text-2xl font-semibold mb-2">No Items to Display</h2>
            <p>Paste your full SQL script in the panel on the left and click "Parse & Check Links" to get started.</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
