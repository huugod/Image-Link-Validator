import React from 'react';
import { useState } from 'react';
import { Item, ItemStatus } from '../types';
import { CheckCircleIcon, XCircleIcon, SpinnerIcon, RefreshIcon, SearchIcon } from './Icons';

interface ItemCardProps {
  item: Item;
  onUrlChange: (internalId: string, newUrl: string) => void;
  onRecheck: (internalId: string) => void;
  onImageLoad: (internalId: string) => void;
  onImageError: (internalId: string) => void;
  isHighlighted?: boolean;
}

const StatusIndicator: React.FC<{ status: ItemStatus }> = ({ status }) => {
  switch (status) {
    case ItemStatus.OK:
      return <div className="flex items-center text-green-400"><CheckCircleIcon className="w-5 h-5 mr-2" /> OK</div>;
    case ItemStatus.ERROR:
      return <div className="flex items-center text-red-400"><XCircleIcon className="w-5 h-5 mr-2" /> Error</div>;
    case ItemStatus.CHECKING:
      return <div className="flex items-center text-yellow-400"><SpinnerIcon className="w-5 h-5 mr-2" /> Checking...</div>;
    default:
      return <div className="flex items-center text-gray-500">Idle</div>;
  }
};


export const ItemCard: React.FC<ItemCardProps> = ({ item, onUrlChange, onRecheck, onImageLoad, onImageError, isHighlighted }) => {
  const [currentUrl, setCurrentUrl] = useState(item.url);
  const [isEditing, setIsEditing] = useState(false);

  const handleUrlUpdate = () => {
    if (currentUrl !== item.url) {
      onUrlChange(item.internalId, currentUrl);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleUrlUpdate();
    } else if (e.key === 'Escape') {
      setCurrentUrl(item.url);
      setIsEditing(false);
    }
  };
  
  const handleFindOnPinterest = () => {
    const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(item.name)}`;
    window.open(searchUrl, '_blank', 'noopener,noreferrer');
  };

  const showImage = item.status === ItemStatus.OK;
  const showSpinner = item.status === ItemStatus.CHECKING;
  const showErrorOverlay = item.status === ItemStatus.ERROR;

  return (
    <div 
        id={`item-${item.internalId}`}
        className={`bg-gray-800 rounded-lg overflow-hidden shadow-lg transition-all duration-300 flex flex-col ${isHighlighted ? 'ring-2 ring-red-500' : 'hover:shadow-cyan-500/20 hover:ring-2 hover:ring-cyan-500/50'}`}
    >
      <div className="relative w-full h-48 bg-gray-700">
        {/* The image is always mounted when a check is needed to trigger loading events */}
        {item.status !== ItemStatus.IDLE && (
            <img 
                key={item.url} // Re-triggers load if URL changes
                src={item.url} 
                alt={item.name} 
                className={`w-full h-full object-cover transition-opacity duration-300 ${showImage ? 'opacity-100' : 'opacity-0'}`}
                referrerPolicy="no-referrer"
                onLoad={() => onImageLoad(item.internalId)}
                onError={() => onImageError(item.internalId)}
            />
        )}

        {showSpinner && (
          <div className="absolute inset-0 flex items-center justify-center">
            <SpinnerIcon className="w-10 h-10 text-cyan-400" />
          </div>
        )}

        {showErrorOverlay && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 bg-opacity-75 p-4">
                <div className="text-center text-red-400">
                    <XCircleIcon className="w-12 h-12 mx-auto" />
                    <p className="mt-2 font-semibold">Image Failed to Load</p>
                </div>
                <button
                    onClick={handleFindOnPinterest}
                    className="mt-4 bg-black/50 hover:bg-black/70 text-white font-semibold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors text-sm"
                >
                    <SearchIcon className="w-4 h-4" />
                    Find on Pinterest
                </button>
            </div>
        )}
      </div>
      <div className="p-4 flex flex-col flex-grow">
        <h3 className="font-bold text-lg text-cyan-300 truncate" title={item.name}>{item.name}</h3>
        <p className="text-sm text-gray-400 mt-1 mb-3 flex-grow">{item.description}</p>
        
        <div className="mb-3">
          <label className="text-xs font-bold text-gray-500">URL</label>
          <div className="relative flex items-center mt-1">
            <input
              type="text"
              value={currentUrl}
              onChange={(e) => setCurrentUrl(e.target.value)}
              onFocus={() => setIsEditing(true)}
              onBlur={handleUrlUpdate}
              onKeyDown={handleKeyDown}
              className="bg-gray-900 text-gray-300 text-sm rounded-md w-full pr-10 py-2 focus:ring-2 focus:ring-cyan-500 focus:outline-none transition"
            />
            <button 
                onClick={() => onRecheck(item.internalId)}
                className="absolute right-2 text-gray-400 hover:text-cyan-400 transition"
                title="Re-check this URL"
            >
                <RefreshIcon className="w-5 h-5"/>
            </button>
          </div>
        </div>
        
        <div className="flex justify-between items-center text-sm font-medium">
          <span className="text-gray-500">Status:</span>
          <StatusIndicator status={item.status} />
        </div>
      </div>
    </div>
  );
};