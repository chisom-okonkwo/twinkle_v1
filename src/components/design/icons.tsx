import { Image } from 'react-native';

const icons = {
  home: require('../../../assets/design/icons/home.png'),
  calendar: require('../../../assets/design/icons/calendar.png'),
  sparkles: require('../../../assets/design/icons/sparkles.png'),
  plus: require('../../../assets/design/icons/plus.png'),
  close: require('../../../assets/design/icons/close.png'),
  search: require('../../../assets/design/icons/search.png'),
  grid: require('../../../assets/design/icons/grid.png'),
  list: require('../../../assets/design/icons/list.png'),
  back: require('../../../assets/design/icons/back.png'),
  check: require('../../../assets/design/icons/check.png'),
  more: require('../../../assets/design/icons/more.png'),
  pin: require('../../../assets/design/icons/pin.png'),
  text: require('../../../assets/design/icons/text.png'),
  camera: require('../../../assets/design/icons/camera.png'),
  mic: require('../../../assets/design/icons/mic.png'),
  image: require('../../../assets/design/icons/image.png'),
  play: require('../../../assets/design/icons/play.png'),
  pause: require('../../../assets/design/icons/pause.png'),
  tag: require('../../../assets/design/icons/tag.png'),
  copy: require('../../../assets/design/icons/copy.png'),
  trash: require('../../../assets/design/icons/trash.png'),
  chevron: require('../../../assets/design/icons/chevron.png'),
  bold: require('../../../assets/design/icons/bold.png'),
  italic: require('../../../assets/design/icons/italic.png'),
  heading: require('../../../assets/design/icons/heading.png'),
  checklist: require('../../../assets/design/icons/checklist.png'),
  quote: require('../../../assets/design/icons/quote.png'),
  arrow: require('../../../assets/design/icons/arrow.png'),
  refresh: require('../../../assets/design/icons/refresh.png'),
};
export type IconName = keyof typeof icons;
export function Icon({ name, size = 22, color = '#292d2d' }: { name: IconName; size?: number; color?: string }) {
  return <Image source={icons[name]} style={{ width: size, height: size, tintColor: color }} accessible={false} />;
}
