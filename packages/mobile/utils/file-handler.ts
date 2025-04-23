import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { API_URL, API_CONFIG } from '@/constants/config';

export type UploadStatus = 'idle' | 'uploading' | 'processing' | 'completed' | 'error';

export interface SharedFile {
  uri?: string;
  mimeType?: string;
  name?: string;
  text?: string;
}

export interface UploadResult {
  status: UploadStatus;
  text?: string | { extractedText?: string; visualElements?: unknown };
  error?: string;
  fileId?: number | string;
  url?: string;
  fileUrl?: string;
  mimeType?: string;
  fileName?: string;
}

export interface UploadResponse {
  success: boolean;
  fileId?: number | string;
  status: string;
  url?: string;
  text?: string;
  error?: string;
  fileUrl?: string;
  mimeType?: string;
  fileName?: string;
}

// Basic content moderation function to screen uploads
const moderateContent = async (text: string | undefined): Promise<{ 
  isAppropriate: boolean;
  reason?: string;
}> => {
  if (!text) return { isAppropriate: true };
  
  // Basic profanity/content check - would use a proper service in production
  const checkTerms = [
    'explicit', 'inappropriate', 'offensive', 'banned'
  ];
  
  // Check for any problematic terms
  for (const term of checkTerms) {
    if (text.toLowerCase().includes(term)) {
      return { 
        isAppropriate: false, 
        reason: `Content contains potentially inappropriate material (${term})` 
      };
    }
  }
  
  return { isAppropriate: true };
};

/**
 * Prepares a file for upload by normalizing paths and generating appropriate filename
 * and mimetype.
 */
export const prepareFile = async (
  file: SharedFile
): Promise<{
  fileName: string;
  mimeType: string;
  fileUri: string | null;
}> => {
  // Determine filename
  const fileName = file.name || `shared-${Date.now()}.${file.mimeType?.split('/')[1] || file.uri?.split('.').pop() || 'file'}`;
  
  // Determine mimetype
  let mimeType: string;
  
  // If file has explicit MIME type, use it
  if (file.mimeType) {
    mimeType = file.mimeType;
  } 
  // Otherwise, try to determine from extension
  else if (file.uri) {
    const fileExtension = file.uri.split('.').pop()?.toLowerCase();
    switch (fileExtension) {
      case 'jpg':
      case 'jpeg':
        mimeType = 'image/jpeg';
        break;
      case 'png':
        mimeType = 'image/png';
        break;
      case 'gif':
        mimeType = 'image/gif';
        break;
      case 'pdf':
        mimeType = 'application/pdf';
        break;
      case 'md':
        mimeType = 'text/markdown';
        break;
      case 'txt':
        mimeType = 'text/plain';
        break;
      case 'doc':
      case 'docx':
        mimeType = 'application/msword';
        break;
      default:
        mimeType = 'application/octet-stream';
    }
  } 
  // Default to octet-stream if we can't determine
  else {
    mimeType = 'application/octet-stream';
  }
  
  // Process paths based on platform
  // For text content, we just want a cache file path that will work
  let fileUri: string | null = null;
  
  if (file.text) {
    // For text content, create a temporary file in the cache directory
    fileUri = `${FileSystem.cacheDirectory}${fileName}`;
    
    // Write the text to the file
    await FileSystem.writeAsStringAsync(fileUri, file.text);
  } 
  // For file content, normalize URI based on platform
  else if (file.uri) {
    fileUri = Platform.select({
      ios: file.uri.replace('file://', ''),
      android: file.uri,
      default: file.uri,
    });
  }
  
  return {
    fileName,
    mimeType,
    fileUri,
  };
};



/**
 * Polls the server for results of file processing
 * This now needs to poll a new status endpoint for R2 uploads
 */
export const pollForResults = async (
    fileId: string | number,
    token: string,
    isTextFile: boolean = false, // Flag to know if it was a direct text upload
    maxAttempts = 30,
    initialDelay = 2000,
    pollInterval = 3000
  ): Promise<UploadResult> => {

  // Ensure fileId is a string for API calls
  const fileIdStr = String(fileId);

  // If it was a direct text upload, it should already be 'completed'
  // We shouldn't need to poll for text files handled by the direct upload endpoint
  if (isTextFile) {
    console.log('Text file detected, skipping polling as it should be complete.');
    // We need to fetch the final details though, as the initial return might lack text
    // Let's use the new status endpoint for consistency
     try {
        const statusResponse = await fetch(`${API_URL}/api/get-upload-status/${fileIdStr}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!statusResponse.ok) {
           throw new Error(`Failed to get initial status for text file: ${statusResponse.statusText}`);
        }
        const finalResult = await statusResponse.json();
        return {
           ...finalResult, // Spread the properties from the status endpoint
           status: finalResult.status || 'completed', // Ensure status is set
           fileId: fileIdStr,
        };
     } catch (error) {
        console.error("Error fetching final status for text file:", error);
        return {
            status: 'error',
            error: 'Failed to get final details for text file',
            fileId: fileIdStr,
        };
     }
  }

  // --- Polling for R2 Uploads --- 
  let attempts = 0;
  console.log("Polling for R2 processing results with fileId:", fileIdStr);

  // Wait an initial delay before starting to poll
  await new Promise(resolve => setTimeout(resolve, initialDelay));

  while (attempts < maxAttempts) {
    try {
      console.log(`Polling attempt ${attempts + 1}/${maxAttempts} for file ${fileIdStr}...`);

      const response = await fetch(`${API_URL}/api/get-upload-status/${fileIdStr}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error polling status: ${response.status} ${response.statusText}`, errorText);

        // If not found yet, just wait and retry
        if (response.status === 404) {
          console.log(`File ${fileIdStr} not found yet, retrying...`);
          attempts++;
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }
        // For other errors, maybe stop polling or retry differently
        // For now, just retry after interval
        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }

      const result = await response.json();
      console.log("Poll status result:", result);

      // Check the status field from the response
      if (result.status === 'completed' || result.status === 'error') {
         // Ensure fileId is included in the final result
         return {
           ...result,
           fileId: fileIdStr,
         };
      } else if (result.status === 'processing' || result.status === 'pending') {
        // Still processing, wait and poll again
        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } else {
        // Unexpected status
        console.warn(`Unexpected status received: ${result.status}`);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

    } catch (error) {
      console.error('Error during pollForResults fetch:', error);
      attempts++;
      // If we've reached max attempts after an error, return error
      if (attempts >= maxAttempts) {
        return {
            status: 'error',
            error: 'Max polling attempts reached after error',
            fileId: fileIdStr
        };
      }
      // Wait before retrying after an error
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  // If loop finishes without success/error status
  return {
    status: 'error',
    error: 'Timed out waiting for processing results',
    fileId: fileIdStr
  };
};


/**
 * Helper function to escape special characters in regex patterns
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Directory for storing pending uploads
const PENDING_UPLOADS_DIR = `${FileSystem.documentDirectory}pending_uploads/`;
const SYNC_QUEUE_FILE = `${FileSystem.documentDirectory}sync_queue.json`;

/**
 * Ensure the pending uploads directory exists
 */
export const ensurePendingUploadsDir = async (): Promise<void> => {
  const dirInfo = await FileSystem.getInfoAsync(PENDING_UPLOADS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(PENDING_UPLOADS_DIR, { intermediates: true });
  }
};

/**
 * Save a file to local storage for later syncing
 */
export const saveFileLocally = async (file: SharedFile): Promise<{ 
  localId: string;
  preview: {
    previewText?: string;
    thumbnailUri?: string;
    previewType: 'text' | 'image' | 'other';
  }
}> => {
  await ensurePendingUploadsDir();
  
  // Create a unique local ID
  const localId = `local-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  
  // Create a directory for this file
  const fileDir = `${PENDING_UPLOADS_DIR}${localId}/`;
  await FileSystem.makeDirectoryAsync(fileDir);
  
  // Generate a preview/thumbnail
  const preview = await generatePreview(file, localId);
  
  // Save the file metadata
  const metadata = {
    name: file.name,
    mimeType: file.mimeType,
    // Don't store the full text in metadata, just a preview
    textPreview: preview.previewText,
    thumbnailUri: preview.thumbnailUri,
    previewType: preview.previewType,
    localId,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  
  await FileSystem.writeAsStringAsync(
    `${fileDir}metadata.json`, 
    JSON.stringify(metadata)
  );
  
  // If it's a text file, save the text content
  if (file.text) {
    await FileSystem.writeAsStringAsync(
      `${fileDir}content.txt`,
      file.text
    );
  } 
  // Otherwise, if it has a URI, copy the file
  else if (file.uri) {
    const { fileName } = await prepareFile(file);
    const destPath = `${fileDir}${fileName}`;
    await FileSystem.copyAsync({
      from: file.uri,
      to: destPath
    });
  }
  
  // Add to sync queue
  await addToSyncQueue(localId);
  
  return { 
    localId,
    preview
  };
};

/**
 * Add a file to the sync queue
 */
export const addToSyncQueue = async (localId: string): Promise<void> => {
  try {
    // Read current queue
    let queue: string[] = [];
    try {
      const queueInfoExists = await FileSystem.getInfoAsync(SYNC_QUEUE_FILE);
      if (queueInfoExists.exists) {
        const queueData = await FileSystem.readAsStringAsync(SYNC_QUEUE_FILE);
        queue = JSON.parse(queueData);
      }
    } catch (error) {
      console.log('Error reading sync queue, starting new queue', error);
      queue = [];
    }
    
    // Add to queue if not already present
    if (!queue.includes(localId)) {
      queue.push(localId);
      await FileSystem.writeAsStringAsync(
        SYNC_QUEUE_FILE,
        JSON.stringify(queue)
      );
    }
  } catch (error) {
    console.error('Error adding to sync queue:', error);
  }
};

/**
 * Process the next item in the sync queue
 */
export const processSyncQueue = async (token: string): Promise<boolean> => {
  try {
    // Check if queue file exists
    const queueInfoExists = await FileSystem.getInfoAsync(SYNC_QUEUE_FILE);
    if (!queueInfoExists.exists) {
      return false; // No queue exists yet
    }

    // Read queue
    const queueData = await FileSystem.readAsStringAsync(SYNC_QUEUE_FILE);
    const queue: string[] = JSON.parse(queueData);

    if (queue.length === 0) {
      return false; // Queue is empty
    }

    // Get the next item
    const localId = queue[0];
    const fileDir = `${PENDING_UPLOADS_DIR}${localId}/`;

    // Check if the file directory exists
    const dirInfo = await FileSystem.getInfoAsync(fileDir);
    if (!dirInfo.exists) {
      // Remove from queue and skip
      queue.shift();
      await FileSystem.writeAsStringAsync(SYNC_QUEUE_FILE, JSON.stringify(queue));
      return queue.length > 0; // Return true if there are more items
    }

    // Read metadata
    const metadataRaw = await FileSystem.readAsStringAsync(`${fileDir}metadata.json`);
    const metadata = JSON.parse(metadataRaw);

    // Don't re-process if already completed or errored too recently
    if (metadata.status === 'completed') {
        console.log(`Skipping already completed file ${localId}`);
        queue.shift();
        await FileSystem.writeAsStringAsync(SYNC_QUEUE_FILE, JSON.stringify(queue));
        return queue.length > 0;
    }
    // Add logic here to check metadata.lastAttempt if status is 'error' to avoid rapid retries
    // const retryThreshold = 5 * 60 * 1000; // e.g., 5 minutes
    // if (metadata.status === 'error' && metadata.lastAttempt && (Date.now() - new Date(metadata.lastAttempt).getTime()) < retryThreshold) {
    //     console.log(`Skipping recently errored file ${localId}`);
    //     // Optionally move to end instead of skipping forever
    //     // queue.push(queue.shift());
    //     // await FileSystem.writeAsStringAsync(SYNC_QUEUE_FILE, JSON.stringify(queue));
    //     return queue.length > 0;
    // }

    // Create a SharedFile object
    const sharedFile: SharedFile = {
      name: metadata.name,
      mimeType: metadata.mimeType,
    };

    // Find the content file
    const contentPathTxt = `${fileDir}content.txt`;
    const contentInfoTxt = await FileSystem.getInfoAsync(contentPathTxt);
    let contentFileUri: string | undefined;

    if (contentInfoTxt.exists) {
      // Text file saved locally
      sharedFile.text = await FileSystem.readAsStringAsync(contentPathTxt);
      // Even for text, we might need a file URI for the upload function if it expects one
      // For the new flow, text is handled separately, so this might not be needed
    } else {
      // Find the binary file in the directory
      const dirContents = await FileSystem.readDirectoryAsync(fileDir);
      const fileNames = dirContents.filter(name => !name.endsWith('.json') && !name.endsWith('.txt'));

      if (fileNames.length > 0) {
        contentFileUri = `${fileDir}${fileNames[0]}`;
        sharedFile.uri = contentFileUri;
      } else {
        console.error(`No content file found for ${localId}, removing from queue.`);
        metadata.status = 'error';
        metadata.error = 'Local content file missing';
        await FileSystem.writeAsStringAsync(`${fileDir}metadata.json`, JSON.stringify(metadata));
        queue.shift();
        await FileSystem.writeAsStringAsync(SYNC_QUEUE_FILE, JSON.stringify(queue));
        return queue.length > 0;
      }
    }

    // Try to process the file using the updated handleFileProcess
    try {
      console.log(`Processing queued file ${localId} with handleFileProcess...`);
      // Use handleFileProcess which now incorporates the new flow
      const result = await handleFileProcess(sharedFile, token, (status, details) => {
          console.log(`Sync Queue Status Update for ${localId}: ${status}`, details);
          // Update metadata status in real-time if needed
          if (metadata.status !== status) {
             metadata.status = status;
             if (details?.fileId) metadata.serverFileId = details.fileId;
             // Avoid writing too frequently here, maybe only on final states
             // FileSystem.writeAsStringAsync(`${fileDir}metadata.json`, JSON.stringify(metadata));
          }
      });

      metadata.lastAttempt = new Date().toISOString();

      // Update metadata based on final result
      if (result.status === 'completed') {
        metadata.status = 'completed';
        metadata.serverFileId = result.fileId;
        // If text was processed, store it (or a reference)
        if (typeof result.text === 'string') {
            metadata.processedTextPreview = generateTextPreview(result.text, 50); // Store preview
        } else if (result.text?.extractedText) {
             metadata.processedTextPreview = generateTextPreview(result.text.extractedText, 50);
        }
        metadata.processedAt = new Date().toISOString();
        metadata.error = undefined; // Clear previous errors

        await FileSystem.writeAsStringAsync(`${fileDir}metadata.json`, JSON.stringify(metadata));
        queue.shift(); // Remove from queue on success
        await FileSystem.writeAsStringAsync(SYNC_QUEUE_FILE, JSON.stringify(queue));
        console.log(`Successfully processed queued file ${localId}`);

      } else if (result.status === 'error') {
        metadata.status = 'error';
        metadata.error = result.error || 'Unknown processing error';

        await FileSystem.writeAsStringAsync(`${fileDir}metadata.json`, JSON.stringify(metadata));
        // Move to the end of the queue on error
        queue.push(queue.shift()!); // Move failed item to the end
        await FileSystem.writeAsStringAsync(SYNC_QUEUE_FILE, JSON.stringify(queue));
        console.log(`Error processing queued file ${localId}, moved to end of queue:`, result.error);
      }
      // else: still processing, leave it in the queue

    } catch (processError) {
      console.error(`Critical error processing queued file ${localId}:`, processError);
      metadata.status = 'error';
      metadata.error = processError instanceof Error ? processError.message : 'Critical processing error';
      metadata.lastAttempt = new Date().toISOString();

      await FileSystem.writeAsStringAsync(`${fileDir}metadata.json`, JSON.stringify(metadata));
       // Move to the end of the queue on critical error
      queue.push(queue.shift()!); // Move failed item to the end
      await FileSystem.writeAsStringAsync(SYNC_QUEUE_FILE, JSON.stringify(queue));
    }

    return queue.length > 0; // Return true if there are more items

  } catch (error) {
    console.error('Error processing sync queue item:', error);
    // If we had an error reading the queue itself, maybe return false to stop processing
    return false;
  }
};

/**
 * Start processing the sync queue in the background
 */
export const startBackgroundSync = async (token: string): Promise<void> => {
  let isProcessing = false;
  
  // Process one item at a time with a delay between items
  const processNextItem = async () => {
    if (isProcessing) return;
    
    isProcessing = true;
    try {
      const hasMoreItems = await processSyncQueue(token);
      if (hasMoreItems) {
        // Schedule next item with a delay
        setTimeout(processNextItem, 5000);
      }
    } catch (error) {
      console.error('Error in background sync:', error);
    } finally {
      isProcessing = false;
    }
  };
  
  // Start processing
  processNextItem();
};

/**
 * Handles a shared file locally first, then queues for background processing
 */
export const handleSharedFile = async (
  file: SharedFile,
  onLocalSaveComplete?: (preview: {
    previewText?: string;
    thumbnailUri?: string;
    previewType: 'text' | 'image' | 'other';
  }) => void
): Promise<string> => {
  try {
    // Save locally first
    const { localId, preview } = await saveFileLocally(file);
    
    // Notify that local save is complete, with preview data
    onLocalSaveComplete?.(preview);
    
    return localId;
  } catch (error) {
    console.error('Error handling shared file:', error);
    throw error;
  }
};

/**
 * Generate a text preview/snippet from full text
 */
export const generateTextPreview = (text: string, maxLength: number = 150): string => {
  if (!text || text.length <= maxLength) return text;
  
  // Try to find a good break point (end of sentence or paragraph)
  const breakPoints = [
    text.indexOf('\n\n', maxLength / 2),
    text.indexOf('. ', maxLength / 2),
    text.indexOf('? ', maxLength / 2),
    text.indexOf('! ', maxLength / 2),
  ].filter(point => point !== -1 && point < maxLength);
  
  // Use the furthest break point that's within our limit
  const breakPoint = breakPoints.length ? Math.max(...breakPoints) + 1 : maxLength;
  
  return text.substring(0, breakPoint) + '...';
};

/**
 * Generate a thumbnail path for an image or create a text preview
 */
export const generatePreview = async (file: SharedFile, localId: string): Promise<{
  previewText?: string;
  thumbnailUri?: string;
  previewType: 'text' | 'image' | 'other';
}> => {
  // Create previews directory if needed
  const previewsDir = `${FileSystem.documentDirectory}previews/`;
  const dirInfo = await FileSystem.getInfoAsync(previewsDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(previewsDir, { intermediates: true });
  }
  
  // For text content, create a text preview
  if (file.text) {
    return {
      previewText: generateTextPreview(file.text),
      previewType: 'text'
    };
  }
  
  // For images, create a thumbnail
  if (file.uri && file.mimeType?.startsWith('image/')) {
    try {
      // Copy the image to the previews directory as the thumbnail
      // In a production app, you'd want to resize this to a smaller size
      const thumbnailUri = `${previewsDir}${localId}-thumb.jpg`;
      await FileSystem.copyAsync({
        from: file.uri,
        to: thumbnailUri
      });
      
      return {
        thumbnailUri,
        previewType: 'image'
      };
    } catch (error) {
      console.error('Error creating thumbnail:', error);
    }
  }
  
  // For other file types
  return {
    previewText: file.name || 'File',
    previewType: 'other'
  };
};

/**
 * Get a list of all pending and completed local files
 */
export const getLocalFiles = async (): Promise<{
  id: string;
  name: string;
  mimeType: string;
  status: string;
  createdAt: string;
  previewText?: string;
  thumbnailUri?: string;
  previewType: 'text' | 'image' | 'other';
  error?: string;
}[]> => {
  try {
    // Ensure directory exists
    await ensurePendingUploadsDir();
    
    // Read all subdirectories
    const dirs = await FileSystem.readDirectoryAsync(PENDING_UPLOADS_DIR);
    
    const localFiles = [];
    
    // Read metadata for each file
    for (const dir of dirs) {
      try {
        const metadataPath = `${PENDING_UPLOADS_DIR}${dir}/metadata.json`;
        const metadataInfo = await FileSystem.getInfoAsync(metadataPath);
        
        if (metadataInfo.exists) {
          const metadataRaw = await FileSystem.readAsStringAsync(metadataPath);
          const metadata = JSON.parse(metadataRaw);
          
          localFiles.push({
            id: metadata.localId || dir,
            name: metadata.name || 'Unnamed file',
            mimeType: metadata.mimeType || 'application/octet-stream',
            status: metadata.status || 'pending',
            createdAt: metadata.createdAt || new Date().toISOString(),
            previewText: metadata.textPreview,
            thumbnailUri: metadata.thumbnailUri,
            previewType: metadata.previewType || 'other',
            error: metadata.error
          });
        }
      } catch (error) {
        console.error(`Error reading metadata for ${dir}:`, error);
      }
    }
    
    // Sort by creation date, newest first
    return localFiles.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (error) {
    console.error('Error getting local files:', error);
    return [];
  }
};