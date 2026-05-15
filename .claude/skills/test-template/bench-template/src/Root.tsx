import { Composition } from 'remotion';
import { Scene } from './Scene';

const FPS = 30;
const DEFAULT_SECONDS = 10;
const WIDTH  = 1920;
const HEIGHT = 1080;

type Props = { durationSeconds: number };

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Comp"
      component={Scene as any}
      durationInFrames={FPS * DEFAULT_SECONDS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ durationSeconds: DEFAULT_SECONDS } as Props}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(FPS * (props as Props).durationSeconds)),
      })}
    />
  );
};
