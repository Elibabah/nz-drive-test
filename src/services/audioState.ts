let _isTTSPlaying = false;

export const isTTSPlaying = () => _isTTSPlaying;
export const setTTSPlaying = (v: boolean) => { _isTTSPlaying = v; };
