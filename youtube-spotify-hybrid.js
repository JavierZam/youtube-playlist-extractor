const axios = require('axios');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

class YouTubeSpotifyHybrid {
    constructor() {
        this.youtubeApiKey = process.env.YOUTUBE_API_KEY;
        this.spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
        this.spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        this.spotifyToken = null;
        
        if (!this.youtubeApiKey) {
            console.error('❌ YouTube API Key not found in environment variables');
            console.log('Please add YOUTUBE_API_KEY to your .env file');
            process.exit(1);
        }
    }

    cleanTitleForSearch(title) {
        return title
            .replace(/\s*\[(Official|Official Video|Official Audio|Official Music Video|Lyric Video|Audio|Video|Music Video|Official Visualizer|Lyrics?)\].*$/i, '')
            .replace(/\s*\((Official|Official Video|Official Audio|Official Music Video|Lyric Video|Audio|Video|Music Video|Official Visualizer|Lyrics?)\).*$/i, '')
            .replace(/\s*【.*】/g, '')
            .replace(/\s*🎥.*$/g, '')
            .replace(/\s*(Dir\.|Directed|Prod\.|Produced).*$/i, '')
            .replace(/\s*\[.*Dir\..*\]/gi, '')
            .replace(/\s*\(.*Dir\..*\)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async getSpotifyToken() {
        if (!this.spotifyClientId || !this.spotifyClientSecret) {
            console.log('⚠️  Spotify credentials not found, skipping Spotify enrichment');
            return null;
        }

        try {
            const credentials = Buffer.from(`${this.spotifyClientId}:${this.spotifyClientSecret}`).toString('base64');
            
            const response = await axios.post('https://accounts.spotify.com/api/token', 
                'grant_type=client_credentials', {
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            this.spotifyToken = response.data.access_token;
            return this.spotifyToken;
        } catch (error) {
            console.log('⚠️  Unable to connect to Spotify, skipping enrichment');
            return null;
        }
    }

    async searchSpotify(searchQuery) {
        if (!this.spotifyToken) return null;

        try {
            const response = await axios.get('https://api.spotify.com/v1/search', {
                params: {
                    q: searchQuery,
                    type: 'track',
                    limit: 1
                },
                headers: {
                    'Authorization': `Bearer ${this.spotifyToken}`
                }
            });

            if (response.data.tracks.items.length > 0) {
                const track = response.data.tracks.items[0];
                return {
                    song: track.name,
                    artist: track.artists.map(a => a.name).join(', '),
                    album: track.album.name,
                    confidence: 'high'
                };
            }
            
            return null;
        } catch (error) {
            console.log(`⚠️  Spotify search error for: ${searchQuery}`);
            return null;
        }
    }

    fallbackParse(title) {
        const cleanTitle = this.cleanTitleForSearch(title);
        
        const patterns = [
            /^(.+?)\s*[-–—]\s*(.+)$/,
            /^(.+?)\s*:\s*(.+)$/,
        ];

        for (let pattern of patterns) {
            const match = cleanTitle.match(pattern);
            if (match) {
                return {
                    song: match[2].trim(),
                    artist: match[1].trim(),
                    confidence: 'medium'
                };
            }
        }

        return {
            song: cleanTitle,
            artist: 'Unknown Artist',
            confidence: 'low'
        };
    }

    async processPlaylistItem(videoTitle) {
        const cleanTitle = this.cleanTitleForSearch(videoTitle);
        
        let spotifyResult = null;
        if (this.spotifyToken) {
            console.log(`🔍 Searching Spotify: ${cleanTitle}`);
            spotifyResult = await this.searchSpotify(cleanTitle);
            
            if (!spotifyResult && cleanTitle.includes('-')) {
                const simplifiedSearch = cleanTitle.split('-').join(' ');
                spotifyResult = await this.searchSpotify(simplifiedSearch);
            }
        }
        
        if (spotifyResult) {
            console.log(`✅ Found: ${spotifyResult.song} - ${spotifyResult.artist}`);
            return spotifyResult;
        }
        
        console.log(`⚠️  No Spotify match, using fallback for: ${cleanTitle}`);
        return this.fallbackParse(videoTitle);
    }

    async getPlaylistVideos(playlistId) {
        let videos = [];
        let nextPageToken = '';

        try {
            do {
                const response = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
                    params: {
                        key: this.youtubeApiKey,
                        playlistId: playlistId,
                        part: 'snippet',
                        maxResults: 50,
                        pageToken: nextPageToken
                    }
                });

                videos = videos.concat(response.data.items);
                nextPageToken = response.data.nextPageToken || '';
                
                console.log(`📥 Retrieving videos... (${videos.length} videos)`);
                
            } while (nextPageToken);

            return videos;
        } catch (error) {
            throw new Error(`Failed to retrieve playlist: ${error.message}`);
        }
    }

    extractPlaylistId(url) {
        const regex = /[&?]list=([a-zA-Z0-9_-]+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    async saveResults(results, filename = 'playlist_hybrid_result.txt') {
        const content = [];
        
        content.push('=== HYBRID YOUTUBE + SPOTIFY EXTRACTION ===');
        content.push(`Total Songs: ${results.length}`);
        content.push(`Created: ${new Date().toLocaleDateString('en-US')}`);
        content.push('');

        results.forEach((result, index) => {
            const confidence = result.confidence === 'high' ? '🎯' : 
                             result.confidence === 'medium' ? '⚡' : '⚠️';
            content.push(`${index + 1}. ${result.song} - ${result.artist} ${confidence}`);
        });

        content.push('');
        content.push('Legend:');
        content.push('🎯 = High confidence (Spotify match)');
        content.push('⚡ = Medium confidence (Pattern match)');
        content.push('⚠️ = Low confidence (Fallback)');

        fs.writeFileSync(filename, content.join('\n'), 'utf8');
        console.log(`\n✅ Results saved to: ${filename}`);
    }

    async extractWithHybrid(playlistUrl) {
        try {
            console.log('🚀 Starting hybrid extraction...\n');

            await this.getSpotifyToken();

            const playlistId = this.extractPlaylistId(playlistUrl);
            if (!playlistId) {
                throw new Error('Invalid playlist URL format');
            }

            console.log('📥 Getting playlist from YouTube...');
            const videos = await this.getPlaylistVideos(playlistId);

            console.log('\n🎵 Processing songs...\n');
            const results = [];
            
            for (let i = 0; i < videos.length; i++) {
                const video = videos[i];
                const title = video.snippet.title;
                
                if (title !== 'Private video' && title !== 'Deleted video') {
                    console.log(`\n[${i + 1}/${videos.length}] Processing: ${title}`);
                    const result = await this.processPlaylistItem(title);
                    results.push(result);
                    
                    if (this.spotifyToken) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            }

            await this.saveResults(results);

            const highConfidence = results.filter(r => r.confidence === 'high').length;
            const mediumConfidence = results.filter(r => r.confidence === 'medium').length;
            const lowConfidence = results.filter(r => r.confidence === 'low').length;

            console.log('\n📊 Extraction Statistics:');
            console.log(`🎯 High confidence (Spotify): ${highConfidence}`);
            console.log(`⚡ Medium confidence (Pattern): ${mediumConfidence}`);
            console.log(`⚠️ Low confidence (Fallback): ${lowConfidence}`);
            console.log(`📝 Total songs: ${results.length}`);

        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
        }
    }
}

async function getUserInput() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('🔗 Enter YouTube playlist URL: ', (url) => {
            rl.close();
            resolve(url.trim());
        });
    });
}

async function main() {
    console.log('🎵 YouTube + Spotify Hybrid Extractor');
    console.log('====================================\n');
    
    console.log('📋 Setup Requirements:');
    console.log('1. YouTube API Key (required): YOUTUBE_API_KEY in .env');
    console.log('2. Spotify API (optional, for better accuracy):');
    console.log('   - SPOTIFY_CLIENT_ID in .env');
    console.log('   - SPOTIFY_CLIENT_SECRET in .env');
    console.log('   - Get credentials from: https://developer.spotify.com/dashboard\n');

    try {
        const extractor = new YouTubeSpotifyHybrid();
        const playlistUrl = await getUserInput();
        
        await extractor.extractWithHybrid(playlistUrl);
        
    } catch (error) {
        console.error(`❌ Fatal Error: ${error.message}`);
    }
}

if (require.main === module) {
    main();
}

module.exports = YouTubeSpotifyHybrid;