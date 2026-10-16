interface AddressProps {
  address: string;
  city: string;
  state: string;
  zip: string;
}

const Address = (props: AddressProps) => {
  const { address, city, state, zip } = props;
  return (
    <div>
      <div>{address}</div>
      <div>
        {city}, {state} {zip}
      </div>
    </div>
  );
};

export default Address;
