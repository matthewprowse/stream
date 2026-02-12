'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Stream = {
    id: string;
    status: 'live' | 'on_jumbotron' | 'offline';
    updated_at: string;
};

export default function DashboardPage() {
    const [streams, setStreams] = useState<Stream[]>([]);

    const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

    useEffect(() => {
        // Initial fetch
        const fetchStreams = async () => {
            const { data, error } = await supabase
                .from('streams')
                .select('*')
                .neq('status', 'offline')
                .neq('id', SYSTEM_ID); // Hide system row
            
            if (data) {
                setStreams(data as Stream[]);
            }
            if (error) console.error('Error fetching streams:', error);
        };

        fetchStreams();

        // Subscribe to changes
        const channel = supabase
            .channel('public:streams')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'streams' },
                (payload) => {
                    console.log('Change received!', payload);
                    fetchStreams(); // Re-fetch for simplicity to handle multiple updates
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const setJumbotronMode = async (mode: 'qr' | 'waiting') => {
        const playbackUrl = mode === 'qr' ? 'internal:qr' : 'internal:waiting';
        
        // 1. Set all real streams to 'live' if they were on jumbotron
        const currentJumbotron = streams.filter(s => s.status === 'on_jumbotron');
        for (const stream of currentJumbotron) {
            await supabase.from('streams').update({ status: 'live' }).eq('id', stream.id);
        }

        // 2. Set System row to on_jumbotron
        await supabase
            .from('streams')
            .upsert({ 
                id: SYSTEM_ID, 
                status: 'on_jumbotron', 
                playback_url: playbackUrl,
                updated_at: new Date().toISOString()
            });
    };

    const pushToJumbotron = async (targetId: string) => {
        // Clear system row first - this makes the UI potentially flicker if we depend on it
        // Instead, let's update the target FIRST.
        
        // 1. Set the target to 'on_jumbotron' immediately.
        // This triggers the jumbotron to switch.
        await supabase
            .from('streams')
            .update({ status: 'on_jumbotron' })
            .eq('id', targetId);

        // 2. Set all OTHER 'on_jumbotron' to 'live'
        const currentJumbotron = streams.filter(s => s.status === 'on_jumbotron');
        for (const stream of currentJumbotron) {
            if (stream.id !== targetId) {
                await supabase
                    .from('streams')
                    .update({ status: 'live' })
                    .eq('id', stream.id);
            }
        }
        
        // 3. Clear system row last
        await supabase.from('streams').update({ status: 'offline' }).eq('id', SYSTEM_ID);
    };

    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <h1 className="text-3xl font-bold text-gray-800">Moderator Dashboard</h1>
                <div className="flex gap-2">
                    <Button onClick={() => setJumbotronMode('qr')} variant="outline">
                        Show QR Code
                    </Button>
                    <Button onClick={() => setJumbotronMode('waiting')} variant="outline">
                        Show Waiting Screen
                    </Button>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {streams.map((stream) => (
                    <Card key={stream.id} className={stream.status === 'on_jumbotron' ? 'border-2 border-red-500' : ''}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                User ID: {stream.id}
                            </CardTitle>
                            {stream.status === 'on_jumbotron' ? (
                                <Badge variant="destructive">ON AIR</Badge>
                            ) : (
                                <Badge variant="secondary">LIVE</Badge>
                            )}
                        </CardHeader>
                        <CardContent>
                            <div className="text-xs text-muted-foreground mt-2">
                                Last Updated: {new Date(stream.updated_at).toLocaleTimeString()}
                            </div>
                        </CardContent>
                        <CardFooter>
                            {stream.status !== 'on_jumbotron' && (
                                <Button 
                                    className="w-full" 
                                    onClick={() => pushToJumbotron(stream.id)}
                                >
                                    Push to Jumbotron
                                </Button>
                            )}
                            {stream.status === 'on_jumbotron' && (
                                <Button className="w-full" disabled variant="outline">
                                    Currently on Jumbotron
                                </Button>
                            )}
                        </CardFooter>
                    </Card>
                ))}
                
                {streams.length === 0 && (
                    <div className="col-span-full text-center py-12 text-gray-500">
                        No active streams found. Go to /stream to start one.
                    </div>
                )}
            </div>
        </div>
    );
}
