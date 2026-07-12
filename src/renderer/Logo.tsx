type LogoProps = {
  className?: string;
};

const BRACKET_PATHS = [
  "M27 10C28.1046 10 29 10.8954 29 12V17.25H22C21.5858 17.25 21.25 17.5858 21.25 18C21.25 18.4142 21.5858 18.75 22 18.75H29V23C29 24.1046 28.1046 25 27 25H16C14.8954 25 14 24.1046 14 23V12C14 10.8954 14.8954 10 16 10H27Z",
  "M33 12C33 10.8954 33.8954 10 35 10H46C47.1046 10 48 10.8954 48 12V23C48 24.1046 47.1046 25 46 25H41.75V18C41.75 17.5858 41.4142 17.25 41 17.25C40.5858 17.25 40.25 17.5858 40.25 18V25H35C33.8954 25 33 24.1046 33 23V12Z",
  "M46 28C47.1046 28 48 28.8954 48 30V41C48 42.1046 47.1046 43 46 43H35C33.8954 43 33 42.1046 33 41V36.25H40C40.4142 36.25 40.75 35.9142 40.75 35.5C40.75 35.0858 40.4142 34.75 40 34.75H33V30C33 28.8954 33.8954 28 35 28H46Z",
  "M27 28C28.1046 28 29 28.8954 29 30V34.75H22.5C22.0858 34.75 21.75 35.0858 21.75 35.5C21.75 35.9142 22.0858 36.25 22.5 36.25H29V41C29 42.1046 28.1046 43 27 43H16C14.8954 43 14 42.1046 14 41V30C14 28.8954 14.8954 28 16 28H27Z"
] as const;

export function Logo({ className }: LogoProps) {
  return (
    <svg
      className={className}
      width="63"
      height="54"
      viewBox="0 0 63 54"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {BRACKET_PATHS.map((d, index) => (
          <clipPath key={index} id={`logo-bracket-clip-${index}`}>
            <path d={d} />
          </clipPath>
        ))}
      </defs>
      {BRACKET_PATHS.map((d, index) => (
        <path
          key={index}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          clipPath={`url(#logo-bracket-clip-${index})`}
        />
      ))}
    </svg>
  );
}
